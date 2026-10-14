import { describe, expect, it } from "vitest"

import { connectionRedactionStatus, redactionInFlight } from "./redactionStatus"

const connection = "c1"

describe("redactionInFlight", () => {
	it("is true while a Connection's Revision is queued or failed and awaiting a retry", () => {
		expect(redactionInFlight([{ authorConnectionId: connection, redactionStatus: "queued" }])).toBe(true)
		expect(redactionInFlight([{ authorConnectionId: connection, redactionStatus: "none" }])).toBe(true)
		expect(redactionInFlight([{ authorConnectionId: connection, redactionStatus: "failed" }])).toBe(true)
	})

	it("is false once redaction is done, or when it can never finish", () => {
		expect(redactionInFlight([{ authorConnectionId: connection, redactionStatus: "done" }])).toBe(false)
		expect(redactionInFlight([{ authorConnectionId: connection, redactionStatus: "too_large" }])).toBe(false)
	})

	it("ignores people's own uploads, which never wait on redaction to be approved", () => {
		expect(redactionInFlight([{ authorConnectionId: null, redactionStatus: "queued" }])).toBe(false)
		expect(redactionInFlight([])).toBe(false)
	})
})

describe("connectionRedactionStatus", () => {
	const inFlight = { authorConnectionId: "c1", redactionStatus: "queued" as const }

	it("says the values are being checked when redaction is on", () => {
		expect(connectionRedactionStatus(inFlight, true)?.message).toBe("Being checked for sensitive values")
	})

	it("mentions no sensitive values when redaction is off", () => {
		const status = connectionRedactionStatus(inFlight, false)
		expect(status?.message).toBe("Being prepared for review")
		expect(status?.blocksApproval).toBe(true)
	})
})
