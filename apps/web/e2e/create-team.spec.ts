import { expect, test } from "@playwright/test"

import { uniqueEmail } from "./support/api"

const password = "correct-horse-battery-staple"

test("a new person signs up into Personal and creates a team", async ({ page }) => {
	await page.goto("/signup")
	await expect(page.getByLabel(/workspace/i)).toHaveCount(0)
	await page.getByLabel("Name", { exact: true }).fill("Ann")
	await page.getByLabel("Email").fill(uniqueEmail("create-team"))
	await page.getByLabel("Password").fill(password)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL("/")
	const sidebar = page.getByRole("complementary", { name: "Library sidebar" })
	await expect(sidebar.getByText("Personal Workspace")).toBeVisible()

	await page.goto("/settings/team")
	await page.getByRole("button", { name: "Create team" }).click()
	const dialog = page.getByRole("dialog", { name: "Create team" })
	await dialog.getByLabel("Team name").fill("Acme")
	await dialog.getByRole("button", { name: "Create team" }).click()

	await expect(page).toHaveURL("/activity")
	await expect(sidebar.getByText("Acme · Team")).toBeVisible()

	await page.goto("/settings/team")
	await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible()
	await expect(page.getByRole("button", { name: "Create team" })).toHaveCount(0)
})
