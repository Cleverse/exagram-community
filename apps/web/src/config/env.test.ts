import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
	vi.unstubAllEnvs()
	vi.resetModules()
	document.head.querySelector('meta[name="exagram-usercontent-origin"]')?.remove()
})

const serveUsercontentOrigin = (content: string) => {
	const meta = document.createElement("meta")
	meta.name = "exagram-usercontent-origin"
	meta.content = content
	document.head.append(meta)
}

describe("VITE_API_ORIGIN", () => {
	it("defaults to the window origin when unset", async () => {
		vi.stubEnv("VITE_API_ORIGIN", undefined)
		const { API_ORIGIN, API_BASE_URL, MCP_SERVER_URL } = await import("./env")

		expect(API_ORIGIN).toBe(window.location.origin)
		expect(API_BASE_URL).toBe(`${window.location.origin}/v1`)
		expect(MCP_SERVER_URL).toBe(`${window.location.origin}/mcp`)
	})

	it("defaults to the window origin when empty", async () => {
		vi.stubEnv("VITE_API_ORIGIN", "")
		const { API_ORIGIN, API_BASE_URL, MCP_SERVER_URL } = await import("./env")

		expect(API_ORIGIN).toBe(window.location.origin)
		expect(API_BASE_URL).toBe(`${window.location.origin}/v1`)
		expect(MCP_SERVER_URL).toBe(`${window.location.origin}/mcp`)
	})

	it("uses the configured origin, with a trailing slash trimmed", async () => {
		vi.stubEnv("VITE_API_ORIGIN", "https://api.example.test/")
		const { API_ORIGIN, API_BASE_URL, MCP_SERVER_URL } = await import("./env")

		expect(API_ORIGIN).toBe("https://api.example.test")
		expect(API_BASE_URL).toBe("https://api.example.test/v1")
		expect(MCP_SERVER_URL).toBe("https://api.example.test/mcp")
	})

	it("throws when it equals VITE_USERCONTENT_ORIGIN", async () => {
		vi.stubEnv("VITE_API_ORIGIN", "http://localhost:3002")
		vi.stubEnv("VITE_USERCONTENT_ORIGIN", "http://localhost:3002")

		await expect(import("./env")).rejects.toThrow("must not equal the API origin")
	})
})

describe("USERCONTENT_ORIGIN", () => {
	it("comes from VITE_USERCONTENT_ORIGIN when index.html names none", async () => {
		vi.stubEnv("VITE_USERCONTENT_ORIGIN", "https://uc-build.example.test")
		const { USERCONTENT_ORIGIN } = await import("./env")

		expect(USERCONTENT_ORIGIN).toBe("https://uc-build.example.test")
	})

	it("comes from index.html's meta tag ahead of VITE_USERCONTENT_ORIGIN", async () => {
		vi.stubEnv("VITE_USERCONTENT_ORIGIN", "https://uc-build.example.test")
		serveUsercontentOrigin("https://uc.example.test")
		const { USERCONTENT_ORIGIN } = await import("./env")

		expect(USERCONTENT_ORIGIN).toBe("https://uc.example.test")
	})

	it("comes from index.html's meta tag when VITE_USERCONTENT_ORIGIN is unset", async () => {
		vi.stubEnv("VITE_USERCONTENT_ORIGIN", undefined)
		serveUsercontentOrigin("https://uc.example.test:8443")
		const { USERCONTENT_ORIGIN } = await import("./env")

		expect(USERCONTENT_ORIGIN).toBe("https://uc.example.test:8443")
	})

	it("throws when neither source names one", async () => {
		vi.stubEnv("VITE_USERCONTENT_ORIGIN", "")

		await expect(import("./env")).rejects.toThrow("No usercontent origin")
	})

	it.each([
		["an empty value", ""],
		["a bare scheme (UC_HOST unset)", "https://"],
		["http", "http://uc.example.test"],
		["a trailing slash", "https://uc.example.test/"],
		["a path", "https://uc.example.test/uc"],
		["a query", "https://uc.example.test?x=1"],
		["userinfo", "https://user@uc.example.test"],
		["an upper-case host", "https://UC.example.test"],
		["an unrendered template", 'https://{{env "UC_HOST"}}'],
	])("throws on a meta tag with %s, without falling back", async (_, content) => {
		vi.stubEnv("VITE_USERCONTENT_ORIGIN", "https://uc-build.example.test")
		serveUsercontentOrigin(content)

		await expect(import("./env")).rejects.toThrow("invalid usercontent origin")
	})

	it("throws when the meta tag names the API origin", async () => {
		vi.stubEnv("VITE_API_ORIGIN", "https://api.example.test")
		serveUsercontentOrigin("https://api.example.test")

		await expect(import("./env")).rejects.toThrow("must not equal the API origin")
	})

	it("throws when the meta tag names the app origin", async () => {
		const location = vi.spyOn(window, "location", "get")
		location.mockReturnValue({ ...window.location, origin: "https://app.example.test" })
		serveUsercontentOrigin("https://app.example.test")

		try {
			await expect(import("./env")).rejects.toThrow("must not be the app origin")
		} finally {
			location.mockRestore()
		}
	})
})
