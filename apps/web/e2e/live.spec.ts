import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { type Page, expect, test } from "@playwright/test"

import { mcp, mintConnectionToken, uniqueEmail } from "./support/api"

/**
 * Live content updates (docs/plans/2026-09-28-sse-content-updates.md, Task 7): every scenario keeps one
 * Page open and untouched (no `.goto`, no reload) while a change lands through a second Page or the api,
 * then asserts the open Page updated on its own. A `window` marker set on the observed Page before the
 * change proves it, since a reload would wipe it.
 */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "out")
const password = "correct-horse-battery-staple"

const markAlive = (page: Page) =>
	page.evaluate(() => {
		;(window as unknown as { __e2eAlive?: boolean }).__e2eAlive = true
	})

const stillAlive = (page: Page) =>
	page.evaluate(() => (window as unknown as { __e2eAlive?: boolean }).__e2eAlive === true)

/** A fresh Workspace per test, so the three scenarios never share state. */
const signUp = async (page: Page, user: { email: string; name: string }) => {
	await page.goto("/signup")
	await page.getByLabel("Name", { exact: true }).fill(user.name)
	await page.getByLabel("Email").fill(user.email)
	await page.getByLabel("Password").fill(password)
	await page.getByLabel("Workspace name").fill(`Live ${Date.now()}`)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL("/activity")
}

/** Creates a Project and keeps its default (Automatic) publish policy, so the Owner's own upload publishes. */
const newProject = async (page: Page, name: string) => {
	await page
		.getByRole("complementary", { name: "Library sidebar" })
		.getByRole("button", { name: "New project" })
		.click()
	const dialog = page.getByRole("dialog", { name: "New project" })
	await dialog.getByLabel("Project name").fill(name)
	await dialog.getByRole("button", { name: "Create project" }).click()
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	await expect(
		page.getByRole("navigation", { name: "Projects" }).getByRole("link", { name: new RegExp(`^${escaped}\\b`) }),
	).toBeVisible()
	await page
		.getByRole("navigation", { name: "Projects" })
		.getByRole("link", { name: new RegExp(`^${escaped}\\b`) })
		.click()
	return new URL(page.url()).pathname.split("/projects/")[1]
}

const upload = async (page: Page, file: string) => {
	await page.getByRole("button", { name: "Upload", exact: true }).click()
	const dialog = page.getByRole("dialog", { name: "Upload" })
	await dialog.getByLabel("File").setInputFiles(join(fixtures, file))
	await dialog.getByRole("button", { name: /^(Upload|Save as a new Revision)$/ }).click()
	await expect(dialog).toBeHidden()
}

test.describe("live content updates over SSE", () => {
	test("a) an open Artifact swaps to a live-approved Revision, with no reload", async ({
		page,
		context,
		request,
		baseURL,
	}) => {
		const origin = baseURL!
		const owner = { email: uniqueEmail("live-a-owner"), name: "Ada" }
		await signUp(page, owner)
		const projectId = await newProject(page, "Live")
		await upload(page, "notes.md")

		// Automatic policy, an Owner's own web upload: v1 is the Current Revision on arrival (as in the
		// DoD's item 6 "Q" project), so the root Library already carries it.
		await page.goto("/")
		await page.getByRole("link", { name: "notes", exact: true }).dblclick()
		await expect(page).toHaveURL(/\/artifacts\/[^/?]+$/)
		const artifactId = new URL(page.url()).pathname.split("/artifacts/")[1]
		const preview = page.getByLabel("Preview of notes")
		await expect(preview.getByText("The first Revision of a doc.")).toBeVisible({ timeout: 10_000 })

		await markAlive(page)

		// A second, throwaway tab does the OAuth dance, the MCP write and the approval; `page` never
		// navigates again after this point, and everything it shows from here comes from the live feed.
		const owner2 = await context.newPage()
		const token = await mintConnectionToken(owner2, request, origin, "read write")

		const uploaded = await mcp(request, origin, token.access_token, {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "artifact_upload",
				arguments: {
					project_id: projectId,
					artifact_id: artifactId,
					kind: "doc",
					title: "notes",
					content: "# Notes\n\nLIVE_UPDATE_MARKER\n",
				},
			},
		})
		expect(uploaded.status, uploaded.text).toBe(200)

		// A Connection's Revision always waits for the Owner (ADR 0013), regardless of publish policy.
		await owner2.goto("/activity")
		const approve = owner2.getByRole("region", { name: "Live approvals" }).getByRole("button", { name: "Approve" })
		await expect(approve).toBeVisible({ timeout: 10_000 })
		await approve.click()
		await expect(owner2.getByRole("button", { name: "Approve" })).toHaveCount(0)
		await owner2.close()

		// The open Artifact updates on its own: `useHeldRevision` either swaps the body in directly (the
		// reader was on the latest Revision, outside Compare or Present — the case here, a plain full-view
		// read) or shows the "New Revision available" bar first and View swaps it in. Either is correct;
		// this asserts whichever the implementation does.
		const swapped = preview.getByText("LIVE_UPDATE_MARKER")
		const viewButton = preview.getByRole("button", { name: "View", exact: true })
		await expect(swapped.or(viewButton)).toBeVisible({ timeout: 10_000 })
		if (await viewButton.isVisible()) await viewButton.click()
		await expect(swapped).toBeVisible({ timeout: 10_000 })

		expect(await stillAlive(page)).toBe(true)
	})

	test("b) an open Library shows an Artifact created over MCP, with no reload", async ({
		page,
		context,
		request,
		baseURL,
	}) => {
		const origin = baseURL!
		const owner = { email: uniqueEmail("live-b-owner"), name: "Blaise" }
		await signUp(page, owner)
		const projectId = await newProject(page, "Made")

		await page.goto("/")
		await expect(page.getByRole("listitem")).toHaveCount(0)
		await markAlive(page)

		const owner2 = await context.newPage()
		const token = await mintConnectionToken(owner2, request, origin, "read write")
		await owner2.close()

		const uploaded = await mcp(request, origin, token.access_token, {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "artifact_upload",
				arguments: { project_id: projectId, kind: "doc", title: "Made over MCP", content: "# From MCP\n" },
			},
		})
		expect(uploaded.status, uploaded.text).toBe(200)

		// A Connection's upload leaves the Artifact Pending, but its row reaches the Owner at once (a
		// null-revision row reaches only its Owner), so the `artifact` topic's insert already shows it.
		// The row can show in more than one place (the list and the sidebar); any one of them proves it arrived.
		await expect(page.getByRole("link", { name: "Made over MCP", exact: true }).first()).toBeVisible({
			timeout: 10_000,
		})
		expect(await stillAlive(page)).toBe(true)
	})

	test("c) an open anonymous Link goes 'gone' live when the Owner revokes it", async ({ page, context }) => {
		const owner = { email: uniqueEmail("live-c-owner"), name: "Cato" }
		await signUp(page, owner)
		await newProject(page, "Linked")
		await upload(page, "notes.md")

		await page.goto("/")
		await page.getByRole("link", { name: "notes", exact: true }).dblclick()
		const artifactId = new URL(page.url()).pathname.split("/artifacts/")[1]
		const preview = page.getByLabel("Preview of notes")

		await preview.getByRole("button", { name: "More actions for notes" }).click()
		await page.getByRole("menuitem", { name: "Links…" }).click()
		await page.getByRole("button", { name: "Create and copy" }).click()
		const url = new URL(await page.getByRole("dialog", { name: "Link" }).locator("code").innerText()).pathname
		await page.getByRole("button", { name: "Close", exact: true }).click()

		// Anonymous: a fresh context borrows no session, same as the DoD's Link scenario.
		const anonymous = await context.browser()!.newContext()
		const anonymousPage = await anonymous.newPage()
		await anonymousPage.goto(url)
		const content = anonymousPage.getByText("The first Revision of a doc.")
		const gone = anonymousPage.getByText("This Link is no longer available.")
		await expect(content).toBeVisible({ timeout: 10_000 })
		await expect(gone).toBeHidden()
		await markAlive(anonymousPage)

		// The token is only ever handed back once, so the Link is found by artifactId to be revoked by id.
		const listed = await page.request.get(`/v1/links?artifactId=${artifactId}`)
		expect(listed.ok(), await listed.text()).toBe(true)
		const { result } = (await listed.json()) as {
			result: { items: { id: string; revokedAt: string | null }[] }
		}
		const linkId = result.items.find((item) => item.revokedAt === null)?.id
		expect(linkId).toBeTruthy()
		const revoked = await page.request.post(`/v1/links/${linkId}/revoke`)
		expect(revoked.ok(), await revoked.text()).toBe(true)

		// The Link page's own inline script (`/l/:token/events`) hides the content; the anonymous tab
		// never navigates, so this is the live signal, not a refusal reload.
		await expect(gone).toBeVisible({ timeout: 10_000 })
		await expect(content).toBeHidden()
		expect(await stillAlive(anonymousPage)).toBe(true)

		await anonymous.close()
	})
})
