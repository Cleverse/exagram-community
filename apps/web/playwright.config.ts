import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173"

/**
 * The definition-of-done run is one ordered story against one workspace, so it runs in a single
 * worker with no retries: a retry would replay sign-ups and uploads that already happened.
 */
export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 90_000,
	expect: { timeout: 15_000 },
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL,
		trace: "retain-on-failure",
		video: "retain-on-failure",
	},
	// Wider than PREVIEW_MIN_VIEWPORT (1280), so a list click previews beside the list rather than opening the page.
	projects: [
		{
			name: "chromium",
			testIgnore: /mobile\//,
			use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
		},
		// The mobile web screens (docs/design/exagram-mobile) at the design's 390×844, with touch.
		{
			name: "mobile",
			testMatch: /mobile\/.*\.spec\.ts/,
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 390, height: 844 },
				isMobile: true,
				hasTouch: true,
				deviceScaleFactor: 3,
			},
		},
	],
})
