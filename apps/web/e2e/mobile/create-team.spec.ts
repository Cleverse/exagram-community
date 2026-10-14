import { expect, test } from "@playwright/test"

import { uniqueEmail } from "../support/api"

const password = "correct-horse-battery-staple"

test("a phone creates a team from the Team tab", async ({ page }) => {
	await page.goto("/signup")
	await page.getByLabel("Name", { exact: true }).fill("Cara")
	await page.getByLabel("Email").fill(uniqueEmail("mobile-team"))
	await page.getByLabel("Password").fill(password)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL("/")

	await page.goto("/settings/team")
	await page.getByRole("button", { name: "Create team" }).click()
	const drawer = page.getByRole("dialog", { name: "Create team" })
	await drawer.getByLabel("Team name").fill("Cara Studio")
	await drawer.getByRole("button", { name: "Create team" }).click()

	await expect(page).toHaveURL("/activity")
	await page.goto("/settings/team")
	await expect(page.getByText("Cara Studio · Team")).toBeVisible()
	await expect(page.getByRole("button", { name: "Create team" })).toHaveCount(0)
})
