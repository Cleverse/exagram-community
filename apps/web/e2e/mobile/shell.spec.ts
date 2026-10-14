import { expect, test } from "@playwright/test"

import { uniqueEmail } from "../support/api"

const password = "correct-horse-battery-staple"

/**
 * The mobile web shell against a real stack at 390×844 (the `mobile` Playwright project). Each lane adds its
 * own spec beside this one; this one only proves the frame: no sideways scroll, the top bar, the nav drawer.
 */
test("a phone gets the mobile shell", async ({ page }) => {
	await page.goto("/signup")
	await page.getByLabel("Name", { exact: true }).fill("Ada")
	await page.getByLabel("Email").fill(uniqueEmail("mobile"))
	await page.getByLabel("Password").fill(password)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL("/")
	await expect(page.locator("html")).toHaveAttribute("data-shell", "mobile")
	const bar = page.getByRole("banner")
	await expect(bar.getByRole("heading", { name: "Artifacts" })).toBeVisible()

	// Nothing on a root screen is wider than the phone.
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
	expect(overflow).toBeLessThanOrEqual(0)

	await bar.getByRole("button", { name: "Menu" }).click()
	const nav = page.getByRole("dialog", { name: "Navigation" })
	await expect(nav).toBeVisible()
	await nav.getByRole("link", { name: /Weekly recap/ }).click()
	await expect(page).toHaveURL("/context")
	await expect(nav).toBeHidden()
})
