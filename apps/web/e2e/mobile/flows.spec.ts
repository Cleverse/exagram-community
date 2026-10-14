import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { type Browser, type Page, expect, test } from "@playwright/test"

import { createTeamAndEnter, uniqueEmail } from "../support/api"

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "out")
const password = "correct-horse-battery-staple"

const signUp = async (page: Page) => {
	await page.goto("/signup")
	await page.getByLabel("Name", { exact: true }).fill("Ada Lovelace")
	await page.getByLabel("Email").fill(uniqueEmail("mobile-flow"))
	await page.getByLabel("Password").fill(password)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL("/")
}

/**
 * One person's story across the lanes at 390×844: upload from the Create drawer, find the file on the home
 * screen, step File actions → Share and back, read it, open its History, search for it, and empty the inbox.
 */
test("upload, share, read, search and the inbox on a phone", async ({ page }) => {
	await signUp(page)
	await page.goto("/")

	// Create → Upload file.
	await page.getByRole("button", { name: "New" }).click()
	const create = page.getByRole("dialog", { name: "Create" })
	await expect(create).toBeVisible()
	await create.getByLabel("Choose files to upload").setInputFiles(join(fixtures, "notes.md"))
	await expect(page.getByRole("link", { name: /notes/ }).first()).toBeVisible()

	// File actions → Share steps into a sub-level; Back returns to File actions.
	await page.getByRole("button", { name: /More actions for notes/ }).click()
	const file = page.getByRole("dialog")
	await expect(file).toContainText("notes")
	await file.getByRole("button", { name: /^Share/ }).click()
	await expect(page.getByRole("dialog", { name: /Share/ })).toBeVisible()
	await page.getByRole("button", { name: "Back" }).click()
	await expect(page.getByRole("dialog", { name: /notes/ })).toBeVisible()
	await page.getByRole("button", { name: "Close" }).click()
	await expect(page.getByRole("dialog")).toBeHidden()

	// Read it, then open its History from the toolbar.
	await page.getByRole("link", { name: /notes/ }).first().click()
	await expect(page).toHaveURL(/\/artifacts\//)
	await page.getByRole("button", { name: "History" }).click()
	await expect(page.getByRole("dialog", { name: /history/i })).toBeVisible()
	// The phone's Back closes the drawer before it leaves the screen.
	await page.goBack()
	await expect(page.getByRole("dialog")).toBeHidden()
	await expect(page).toHaveURL(/\/artifacts\//)
	await page.goBack()
	await expect(page).toHaveURL("/")

	// Search finds it.
	await page.getByRole("banner").getByRole("button", { name: "Search" }).click()
	const search = page.getByRole("dialog", { name: "Search" })
	await search.getByLabel("Search Workspace").fill("notes")
	await expect(search.getByRole("link", { name: /notes/ }).first()).toBeVisible()
	await page.getByRole("button", { name: "Close" }).click()

	// The inbox opens from the bell; Mark all read empties the badge.
	await page
		.getByRole("banner")
		.getByRole("button", { name: /^Activity/ })
		.click()
	await expect(page).toHaveURL(/\/activity/)
	await page.getByRole("button", { name: "Mark all read" }).click()
	await page
		.getByRole("button", { name: /^Back|All artifacts|Artifacts/ })
		.first()
		.click()
	await expect(page.getByRole("banner").getByRole("button", { name: "Activity" })).toBeVisible()

	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
	expect(overflow).toBeLessThanOrEqual(0)
})

const phone = { width: 390, height: 844 }

const newPerson = async (browser: Browser, baseURL: string | undefined) => {
	const context = await browser.newContext({ baseURL, viewport: phone, isMobile: true, hasTouch: true })
	return { context, page: await context.newPage() }
}

const issueInvite = async (page: Page, email: string): Promise<string> => {
	const response = await page.request.post("/v1/workspace/invites", {
		data: { email, role: "member" },
		headers: { Origin: new URL(page.url()).origin },
	})
	expect(response.ok(), await response.text()).toBe(true)
	return new URL(((await response.json()) as { result: { url: string } }).result.url).pathname
}

const joinByLink = async (page: Page, name: string, path: string) => {
	await page.goto(path)
	await page.getByLabel("Name", { exact: true }).fill(name)
	await page.getByLabel("Password").fill(password)
	await page.getByRole("button", { name: "Join" }).click()
}

test("invite, approve a request and run a group on a phone", async ({ page, browser, baseURL }) => {
	await signUp(page)
	await createTeamAndEnter(page, "Cara Studio")
	const settings = await page.request.patch("/v1/workspace/joining", {
		data: { memberInvites: true, joinApproval: "admin" },
		headers: { Origin: new URL(page.url()).origin },
	})
	expect(settings.ok(), await settings.text()).toBe(true)

	await page.goto("/settings/team")
	await expect(page.getByText("1 member · 1 admin")).toBeVisible()
	await expect(page.getByRole("region", { name: "Joining and sharing" })).toBeVisible()

	const graceEmail = uniqueEmail("grace")
	await page.getByRole("button", { name: "Invite member" }).click()
	const invite = page.getByRole("dialog", { name: "Invite member" })
	await invite.getByLabel("Email").fill(graceEmail)
	await invite.getByRole("button", { name: "Create invite link" }).click()
	const link = invite.getByText(/\/join\//)
	await expect(link).toBeVisible()
	const gracePath = new URL((await link.textContent()) ?? "").pathname
	await invite.getByRole("button", { name: "Done" }).click()
	await expect(page.getByRole("dialog")).toBeHidden()
	await expect(page.getByRole("region", { name: "Pending invites" }).getByText(graceEmail)).toBeVisible()

	const grace = await newPerson(browser, baseURL)
	await joinByLink(grace.page, "Grace Hopper", gracePath)
	await expect(grace.page).toHaveURL("/")
	const pimPath = await issueInvite(grace.page, uniqueEmail("pim"))
	const pim = await newPerson(browser, baseURL)
	await joinByLink(pim.page, "Pim Rattanakul", pimPath)
	await expect(pim.page).toHaveURL(/\/join\/pending/)

	await page.reload()
	const requests = page.getByRole("region", { name: "Join requests" })
	await expect(requests.getByText("Pim Rattanakul")).toBeVisible()
	await requests.getByRole("button", { name: "Approve Pim Rattanakul" }).click()
	await expect(page.getByText("Pim Rattanakul approved — they can open the workspace now.")).toBeVisible()
	await expect(requests).toBeHidden()
	await expect(page.getByRole("list", { name: "Members" }).getByText("Pim Rattanakul")).toBeVisible()

	await page.getByRole("button", { name: "New group" }).click()
	const created = page.getByRole("dialog", { name: "New group" })
	await created.getByLabel("Name").fill("Design team")
	await expect(created.getByRole("button", { name: "Create group" })).toBeDisabled()
	await created.getByRole("checkbox", { name: /Grace Hopper/ }).check()
	await created.getByRole("checkbox", { name: /Pim Rattanakul/ }).check()
	await created.getByRole("button", { name: "Create group" }).click()
	await expect(page.getByText("Design team created with 2 members.")).toBeVisible()
	const groups = page.getByRole("list", { name: "Groups" })
	await expect(groups.getByText("2 members")).toBeVisible()

	await page.getByRole("button", { name: "Edit Design team" }).click()
	const edit = page.getByRole("dialog", { name: "Edit group" })
	await edit.getByRole("checkbox", { name: /Pim Rattanakul/ }).uncheck()
	await edit.getByRole("button", { name: "Save changes" }).click()
	await expect(
		page.getByText("Design team updated — access through this group follows the new member list."),
	).toBeVisible()
	await expect(groups.getByText("1 member")).toBeVisible()

	await page.getByRole("button", { name: "Edit Design team" }).click()
	await page.getByRole("button", { name: "Delete group" }).click()
	await page.getByRole("dialog", { name: "Delete Design team?" }).getByRole("button", { name: "Delete group" }).click()
	await expect(page.getByText("Design team deleted — access given through this group is removed.")).toBeVisible()
	await expect(page.getByText("No groups yet. Create one to share with several people at once.")).toBeVisible()

	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
	expect(overflow).toBeLessThanOrEqual(0)
	await grace.context.close()
	await pim.context.close()
})
