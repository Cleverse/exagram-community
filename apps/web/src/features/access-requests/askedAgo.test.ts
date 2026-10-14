import { describe, expect, it } from "vitest"

import { askedAgo } from "./askedAgo"

describe("askedAgo", () => {
	it.each([
		[10_000, "just now"],
		[60_000, "a minute ago"],
		[59 * 60_000, "59 minutes ago"],
		[60 * 60_000, "an hour ago"],
		[23 * 3_600_000, "23 hours ago"],
		[24 * 3_600_000, "a day ago"],
		[3 * 24 * 3_600_000, "3 days ago"],
	])("reads %i ms as %s", (elapsed, text) => expect(askedAgo(elapsed)).toBe(text))
})
