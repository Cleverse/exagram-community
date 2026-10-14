import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { type Page, expect, test } from "@playwright/test"

import { createTeamAndEnter, exchangeCode, mcp, pkce, registerClient, uniqueEmail } from "./support/api"

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "out")
const password = "correct-horse-battery-staple"
const workspaceName = `DoD ${Date.now()}`
const owner = { email: uniqueEmail("owner"), name: "Ada" }
const reader = { email: uniqueEmail("reader"), name: "Grace" }

const signUp = async (page: Page, user: { email: string; name: string }) => {
	await page.goto("/signup")
	await page.getByLabel("Name", { exact: true }).fill(user.name)
	await page.getByLabel("Email").fill(user.email)
	await page.getByLabel("Password").fill(password)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL("/")
}

const inviteLinkPath = async (page: Page, email: string): Promise<string> => {
	const response = await page.request.post("/v1/workspace/invites", {
		data: { email, role: "member" },
		headers: { Origin: new URL(page.url()).origin },
	})
	expect(response.ok()).toBe(true)
	return new URL(((await response.json()) as { result: { url: string } }).result.url).pathname
}

const joinByInvite = async (page: Page, user: { name: string }, path: string) => {
	await page.goto(path)
	await page.getByLabel("Name", { exact: true }).fill(user.name)
	await page.getByLabel("Password").fill(password)
	await page.getByRole("button", { name: "Join" }).click()
	await expect(page).toHaveURL("/")
}

const signIn = async (page: Page, email: string) => {
	await page.goto("/signin")
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill(password)
	await page.getByRole("button", { name: "Sign in" }).click()
	await expect(page).toHaveURL("/")
}

/**
 * "Sign out" lives inside the account menu, a `role="menu"` popover of `menuitem` buttons, opened by
 * the account button at the foot of the sidebar (titled and named "Account").
 */
const signOut = async (page: Page) => {
	await page.getByTitle("Account").click()
	await page.getByRole("menuitem", { name: "Sign out" }).click()
}

/**
 * Projects live in the sidebar's `<nav aria-label="Projects">`, one link per Project. The link's
 * accessible name also carries its Artifact count (e.g. "P 0"), so match a name prefix.
 */
const openProject = async (page: Page, name: string) => {
	await page.goto("/")
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	await page
		.getByRole("navigation", { name: "Folders" })
		.getByRole("link", { name: new RegExp(`^${escaped}\\b`) })
		.click()
}

const upload = async (page: Page, file: string, asRevision = false) => {
	if (asRevision) {
		const title = file.replace(/\.[^.]+$/, "")
		await page
			.getByLabel(`Preview of ${title}`)
			.getByRole("button", { name: `More actions for ${title}` })
			.click()
		await page.getByRole("menuitem", { name: "Upload a new version" }).click()
	} else {
		// `exact` keeps "Upload" off the library's "My uploads" filter pill, which is also a button.
		await page.getByRole("button", { name: "Upload", exact: true }).click()
	}
	// Scope to the dialog: the button that opened it is still on the page and shares its name.
	const dialog = page.getByRole("dialog", { name: "Upload" })
	await dialog.getByLabel("File").setInputFiles(join(fixtures, file))
	await dialog.getByRole("button", { name: /^(Upload|Save as a new Revision)$/ }).click()
	await expect(dialog).toBeHidden()
}

test.describe.serial("definition of done", () => {
	test("item 2: two users in one workspace, and a Project", async ({ page }) => {
		await signUp(page, owner)
		await createTeamAndEnter(page, workspaceName)
		// The sidebar names the organization.
		const sidebar = page.getByRole("complementary", { name: "Library sidebar" })
		await expect(sidebar.getByText(`${workspaceName} · Team`)).toBeVisible()
		// Two buttons open the project dialog ("+" in the sidebar, folder-plus in the list header);
		// the sidebar is the one with a stable container to scope to.
		await page
			.getByRole("complementary", { name: "Library sidebar" })
			.getByRole("button", { name: "New folder" })
			.click()
		const newProject = page.getByRole("dialog", { name: "New folder" })
		await newProject.getByLabel("Folder name").fill("P")
		// A new Project publishes the Owner's uploads on arrival; items 3–7 walk the Approval path, so P waits.
		await newProject.getByRole("radio", { name: "Manual approval only" }).check()
		await newProject.getByRole("button", { name: "Create folder" }).click()
		await expect(page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: /^P\b/ })).toBeVisible()

		const readerInvite = await inviteLinkPath(page, reader.email)
		await signOut(page)
		await joinByInvite(page, reader, readerInvite)
		await expect(page.getByRole("listitem")).toHaveCount(0)
	})

	test("item 3: uploads start Pending, and the other member sees nothing", async ({ page }) => {
		await signIn(page, owner.email)
		await openProject(page, "P")
		await upload(page, "board-pack.pdf")
		await upload(page, "revenue.xlsx")

		// ProjectPage carries no Pending link (that chip only renders on the Library root); go direct.
		await page.goto("/activity")
		const approvals = page.getByRole("region", { name: "P approvals" }).getByRole("listitem")
		await expect(approvals).toHaveCount(2)
		await expect(approvals.first()).toContainText("v1")

		await signOut(page)
		await signIn(page, reader.email)
		await page.goto("/activity")
		await expect(page.getByText("Nothing has happened yet.")).toBeVisible()
		await page.goto("/")
		await expect(page.getByRole("listitem")).toHaveCount(0)
	})

	test("item 4: a pinned grant keeps reading v1 after v2 is approved", async ({ page }) => {
		await signIn(page, owner.email)
		await page.goto("/activity")
		const approveButtons = page.getByRole("button", { name: "Approve" })
		// The Pending query is still in flight right after navigation, so a `count()` taken immediately
		// reads 0; wait for the list to actually land before counting what is in it.
		await expect(approveButtons.first()).toBeVisible()
		// Approving one re-renders the list on its own schedule (a query invalidation, not an immediate DOM
		// change), so wait for the count to actually drop before clicking the next one rather than racing a
		// stale `.all()` snapshot or a `count()` read against an in-flight refetch.
		for (let remaining = await approveButtons.count(); remaining > 0; remaining--) {
			await approveButtons.first().click()
			await expect(approveButtons).toHaveCount(remaining - 1)
		}
		await page.goto("/")
		// A single click selects the row and opens the preview pane; the reading view needs a double click.
		await page.getByRole("link", { name: /board-pack/ }).dblclick()
		const artifactId = new URL(page.url()).pathname.split("/artifacts/")[1]
		const pdfPreview = page.getByLabel("Preview of board-pack")
		const canvas = pdfPreview.frameLocator('iframe[title="Contents of board-pack"]').locator("canvas").first()
		await expect(canvas).toBeVisible()
		await expect(pdfPreview.getByRole("heading", { name: "Page 1", exact: true })).toHaveCount(0)
		const historyLength = await page.evaluate(() => history.length)
		const canvasWidth = await canvas.evaluate((element) => parseFloat(getComputedStyle(element).width))
		await pdfPreview.getByRole("button", { name: "Zoom" }).click()
		await page.getByRole("menu", { name: "Zoom level" }).getByRole("menuitemradio", { name: "150%" }).click()
		await expect
			.poll(() => canvas.evaluate((element) => parseFloat(getComputedStyle(element).width)))
			.toBeGreaterThan(canvasWidth)
		expect(await page.evaluate(() => history.length)).toBe(historyLength)

		await pdfPreview.getByRole("button", { name: "Share" }).click()
		await page.getByLabel("Email").fill(reader.email)
		await page.getByRole("button", { name: "Invite" }).click()
		// `exact`: the dialog's "Default pin" select also matches a bare "Pin".
		await page.getByRole("combobox", { name: "Pin", exact: true }).selectOption({ label: "v1" })
		await page.getByRole("button", { name: "Close", exact: true }).click()

		await upload(page, "board-pack.pdf", true)
		await page.goto("/activity")
		await page.getByRole("button", { name: "Approve" }).click()

		await signOut(page)
		await signIn(page, reader.email)
		await page.goto(`/artifacts/${artifactId}`)
		// The reader is served v1 and, as a pinned reader, is never told a pin or a newer Revision exists.
		const readerPreview = page.getByLabel("Preview of board-pack")
		// The header's meta starts with the served Revision ("v1 · edited 1m ago"); its wording after that varies.
		await expect(readerPreview).toContainText("v1 · ")
		await expect(readerPreview).not.toContainText("Pinned")
		await expect(readerPreview).not.toContainText("v2")

		// A bare `request` fixture carries no session cookie; `page.request` shares the signed-in reader's.
		const withheld = await page.request.get(`/v1/artifacts/${artifactId}/revisions`)
		const missing = await page.request.get("/v1/artifacts/00000000-0000-0000-0000-000000000000/revisions")
		expect(withheld.status()).toBe(404)
		expect(missing.status()).toBe(404)
		expect(await withheld.text()).toBe(await missing.text())
	})

	test("item 4b: a PPTX preview points at Microsoft's viewer", async ({ page }) => {
		await signIn(page, owner.email)
		await page
			.getByRole("complementary", { name: "Library sidebar" })
			.getByRole("button", { name: "New folder" })
			.click()
		const project = page.getByRole("dialog", { name: "New folder" })
		await project.getByLabel("Folder name").fill("S")
		await project.getByRole("button", { name: "Create folder" }).click()
		await expect(page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: /^S\b/ })).toBeVisible()
		await openProject(page, "S")
		await upload(page, "board-pack.pptx")

		await expect(page.getByRole("link", { name: "board-pack", exact: true })).toBeVisible()
		await page.getByRole("link", { name: "board-pack", exact: true }).dblclick()
		const frame = page.getByLabel("Preview of board-pack").locator('iframe[title="Contents of board-pack"]')
		await expect(frame).toBeVisible()
		const src = await frame.getAttribute("src")
		expect(src).toMatch(/^https:\/\/view\.officeapps\.live\.com\/op\/embed\.aspx\?src=/)
		expect(src).toContain(encodeURIComponent("/file.pptx"))
		expect(new URL(src!).searchParams.get("src")).toMatch(/\/uc\/[^/]+\/file\.pptx$/)
		await expect(frame).not.toHaveAttribute("sandbox")

		await page.goto("/")
		await signOut(page)
	})

	test("item 5: a link serves twice and then refuses", async ({ page, context }) => {
		await signIn(page, owner.email)
		await page.goto("/")
		await page.getByRole("link", { name: /revenue/ }).dblclick()
		const preview = page.getByLabel("Preview of revenue")
		// A double click opens the file's own page; Back returns to the list with it previewed, and Open goes back.
		await expect(page).toHaveURL(/\/artifacts\/[^/?]+$/)
		await preview.getByRole("button", { name: "Back", exact: true }).click()
		await expect(page).toHaveURL(/[?&]preview=/)
		await expect(preview.getByRole("button", { name: "Open", exact: true })).toBeVisible()
		await preview.getByRole("button", { name: "Open", exact: true }).click()
		await expect(page).toHaveURL(/\/artifacts\/[^/?]+$/)
		await expect(preview.getByRole("button", { name: "Back", exact: true })).toBeVisible()
		await expect(preview.getByRole("button", { name: "Open", exact: true })).toBeHidden()
		await preview.getByRole("button", { name: "Back", exact: true }).click()
		await expect(preview.getByRole("button", { name: "Open", exact: true })).toBeVisible()
		await preview.getByRole("button", { name: "More actions for revenue" }).click()
		await page.getByRole("menuitem", { name: "Links…" }).click()
		await page.getByLabel("Max views").fill("2")
		await page.getByRole("button", { name: "Create and copy" }).click()

		// The Link is minted against the api's APP_ORIGIN, which may be a tunnel; visit it via baseURL.
		const url = new URL(await page.getByRole("dialog", { name: "Link" }).locator("code").innerText()).pathname
		await page.getByRole("button", { name: "Close", exact: true }).click()

		// A fresh context each time: a Link is anonymous, and must not borrow the owner's session.
		for (const attempt of [1, 2]) {
			const anonymous = await context.browser()!.newContext()
			const anonymousPage = await anonymous.newPage()
			await anonymousPage.goto(url)
			await expect(anonymousPage.getByText("Q3"), `view ${attempt}`).toBeVisible()
			await anonymous.close()
		}

		const exhausted = await context.browser()!.newContext()
		const exhaustedPage = await exhausted.newPage()
		await exhaustedPage.goto(url)
		await expect(exhaustedPage.getByText("Q3")).toBeHidden()
		await exhausted.close()

		await preview.getByRole("button", { name: "More actions for revenue" }).click()
		await page.getByRole("menuitem", { name: "Ledger" }).click()
		// The Ledger is every read of the Artifact, not just this Link's — opening the Artifact page to
		// press "Link" is itself a `web`-surface read — so scope both counts to the Link's own rows.
		await expect(page.getByRole("row", { name: /Link.*Served/ })).toHaveCount(2)
		await expect(page.getByRole("row", { name: /Link.*Withheld/ })).toHaveCount(1)
	})

	test("item 6: a read-only connection sees its person's reach and refuses other artifacts", async ({
		page,
		request,
		baseURL,
	}) => {
		await signIn(page, owner.email)
		await page
			.getByRole("complementary", { name: "Library sidebar" })
			.getByRole("button", { name: "New folder" })
			.click()
		const ownerProject = page.getByRole("dialog", { name: "New folder" })
		await ownerProject.getByLabel("Folder name").fill("Q")
		await ownerProject.getByRole("button", { name: "Create folder" }).click()
		await expect(page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: /^Q\b/ })).toBeVisible()
		await openProject(page, "Q")
		// Q keeps the default publish policy, so the Owner's upload is the Current Revision on arrival.
		await upload(page, "notes.md")
		await page.goto("/")
		await page.getByRole("link", { name: "notes", exact: true }).dblclick()
		const ownedArtifactId = new URL(page.url()).pathname.split("/artifacts/")[1]

		await page.goto("/")
		await signOut(page)
		await signIn(page, reader.email)
		await page
			.getByRole("complementary", { name: "Library sidebar" })
			.getByRole("button", { name: "New folder" })
			.click()
		const readerProject = page.getByRole("dialog", { name: "New folder" })
		await readerProject.getByLabel("Folder name").fill("R")
		await readerProject.getByRole("button", { name: "Create folder" }).click()
		await expect(page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: /^R\b/ })).toBeVisible()
		await openProject(page, "R")
		// R keeps the default publish policy too, so this upload is current on arrival.
		await upload(page, "chat.json")
		await page.goto("/")
		await page.getByRole("link", { name: "chat", exact: true }).dblclick()
		const otherArtifactId = new URL(page.url()).pathname.split("/artifacts/")[1]

		await page.goto("/")
		await signOut(page)
		await signIn(page, owner.email)
		const origin = baseURL!
		const redirectUri = `http://127.0.0.1:${new URL(origin).port || "5173"}/e2e-callback`
		const resource = `${origin}/mcp`
		const { challenge, verifier } = pkce()
		const client = await registerClient(request, origin, redirectUri)
		const authorize = new URL(`${origin}/oauth/auth`)
		authorize.search = new URLSearchParams({
			client_id: client.client_id,
			response_type: "code",
			redirect_uri: redirectUri,
			scope: "openid read",
			resource,
			code_challenge: challenge,
			code_challenge_method: "S256",
			state: "dod-read",
		}).toString()
		await page.goto(authorize.toString())
		await expect(page).toHaveURL(/\/oauth\/consent\//)
		await expect(page.getByLabel(/Read every Artifact/)).toBeChecked()
		await expect(page.getByLabel(/Write Revisions/)).toHaveCount(0)
		await page.getByRole("button", { name: "Allow" }).click()
		await page.waitForURL(/e2e-callback\?/)
		const token = await exchangeCode(request, origin, {
			code: new URL(page.url()).searchParams.get("code")!,
			clientId: client.client_id,
			redirectUri,
			verifier,
			resource,
		})
		expect(token.scope).toContain("read")
		expect(token.scope).not.toContain("write")

		const listed = await mcp(request, origin, token.access_token, {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "artifact_list", arguments: {} },
		})
		expect(listed.text).toContain("notes")
		expect(listed.text).toContain("board-pack")
		expect(listed.text).not.toContain("chat")
		const found = await mcp(request, origin, token.access_token, {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "artifact_search", arguments: { query: "notes" } },
		})
		expect(found.text).toContain(ownedArtifactId)
		const readable = await mcp(request, origin, token.access_token, {
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "artifact_read", arguments: { artifact_id: ownedArtifactId } },
		})
		expect(readable.text).toContain("The first Revision of a doc.")
		const outside = await mcp(request, origin, token.access_token, {
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "artifact_read", arguments: { artifact_id: otherArtifactId } },
		})
		const absent = await mcp(request, origin, token.access_token, {
			jsonrpc: "2.0",
			id: 5,
			method: "tools/call",
			params: { name: "artifact_read", arguments: { artifact_id: "00000000-0000-0000-0000-000000000000" } },
		})
		expect(outside.text.replace(/"id":4/, '"id":0')).toBe(absent.text.replace(/"id":5/, '"id":0'))
	})

	test("item 7: a connection writes, and the owner still approves", async ({ page, request, baseURL }) => {
		const origin = baseURL!
		// RFC 8252 §7.3: a native client's redirect URI is a loopback IP literal, never "localhost" —
		// distinct from the app origin above. The port still has to track it so a non-default
		// `E2E_BASE_URL` (e.g. a different port) keeps the callback reachable.
		const appPort = new URL(baseURL!).port || "5173"
		const redirectUri = `http://127.0.0.1:${appPort}/e2e-callback`
		const resource = `${origin}/mcp`
		const { challenge, verifier } = pkce()
		const client = await registerClient(request, origin, redirectUri)

		await signIn(page, owner.email)
		const authorize = new URL(`${origin}/oauth/auth`)
		authorize.search = new URLSearchParams({
			client_id: client.client_id,
			response_type: "code",
			redirect_uri: redirectUri,
			scope: "openid read write",
			resource,
			code_challenge: challenge,
			code_challenge_method: "S256",
			state: "dod",
		}).toString()

		await openProject(page, "P")
		await expect(page).toHaveURL(/\/projects\//)
		const projectId = new URL(page.url()).pathname.split("/projects/")[1]

		await page.goto(authorize.toString())
		await expect(page).toHaveURL(/\/oauth\/consent\//)
		await page.getByLabel(/Write Revisions/).check()
		await page.getByRole("button", { name: "Allow" }).click()
		await page.waitForURL(/e2e-callback\?/)

		const code = new URL(page.url()).searchParams.get("code")!
		const token = await exchangeCode(request, origin, {
			code,
			clientId: client.client_id,
			redirectUri,
			verifier,
			resource,
		})
		expect(token.scope).toContain("write")

		const tools = await mcp(request, origin, token.access_token, {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/list",
		})
		expect(tools.status).toBe(200)
		expect(tools.text).toContain("artifact_upload")

		const uploaded = await mcp(request, origin, token.access_token, {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: {
				name: "artifact_upload",
				arguments: {
					project_id: projectId,
					title: "Written by a Connection",
					kind: "doc",
					content: "# From the AI\n",
				},
			},
		})
		expect(uploaded.status).toBe(200)
		// The tool answers "Wrote Revision 1 of Artifact <id>. …" — item 7 reads that same id back.
		const writtenId = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(uploaded.text)![0]

		// Pending to the Owner, invisible to its own author until approved.
		await page.goto("/activity")
		// Activity also lists the write in its event feed; the approvals block is where the Owner acts on it.
		await expect(
			page.getByRole("region", { name: "P approvals" }).getByRole("link", { name: "Written by a Connection" }),
		).toBeVisible()

		const beforeApproval = await mcp(request, origin, token.access_token, {
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "artifact_read", arguments: { artifact_id: writtenId } },
		})
		expect(beforeApproval.text).not.toContain("From the AI")

		// The same Connection wrote it, so it may still read it back by asking for the latest Revision.
		// A Connection read fails closed until the worker has redacted the Revision, so wait for that job.
		const readOwnWrite = async () =>
			(
				await mcp(request, origin, token.access_token, {
					jsonrpc: "2.0",
					id: 4,
					method: "tools/call",
					params: { name: "artifact_read", arguments: { artifact_id: writtenId, revision: "latest" } },
				})
			).text
		await expect.poll(readOwnWrite, { timeout: 15_000 }).toContain("From the AI")
		expect(await readOwnWrite()).toContain("Revision 1, pending")

		await page.getByRole("button", { name: "Approve" }).click()
		await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0)

		const afterApproval = await mcp(request, origin, token.access_token, {
			jsonrpc: "2.0",
			id: 5,
			method: "tools/call",
			params: { name: "artifact_read", arguments: { artifact_id: writtenId } },
		})
		expect(afterApproval.text).toContain("From the AI")
	})
})
