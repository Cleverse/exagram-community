import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { type Page, expect, test } from "@playwright/test"

import { uniqueEmail } from "../support/api"

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "out")
const password = "correct-horse-battery-staple"

const signUp = async (page: Page) => {
	await page.goto("/signup")
	await page.getByLabel("Name", { exact: true }).fill("Ada Lovelace")
	await page.getByLabel("Email").fill(uniqueEmail("mobile-flow"))
	await page.getByLabel("Password").fill(password)
	await page.getByLabel("Workspace name").fill(`Mobile flow ${Date.now()}`)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL("/activity")
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
	await search.getByLabel("Search projects and files").fill("notes")
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
