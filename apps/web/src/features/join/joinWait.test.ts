import { ApiError } from "@exagram/api-client"
import { describe, expect, it } from "vitest"

import { joinWaitPath } from "./joinWait"

describe("joinWaitPath", () => {
	it("sends a pending Join Request to the waiting page and a declined one to the declined page", () => {
		expect(joinWaitPath(new ApiError(403, "Waiting.", "JOIN_PENDING"))).toBe("/join/pending")
		expect(joinWaitPath(new ApiError(403, "Declined.", "JOIN_DECLINED"))).toBe("/join/declined")
	})

	it("leaves every other failure for the page to show", () => {
		expect(joinWaitPath(new ApiError(403, "Sign-up is closed."))).toBeNull()
		expect(joinWaitPath(new ApiError(403, "Closed.", "SIGNUP_CLOSED"))).toBeNull()
		expect(joinWaitPath(new ApiError(401, "Wrong code.", "constructor"))).toBeNull()
		expect(joinWaitPath(new Error("offline"))).toBeNull()
		expect(joinWaitPath(undefined)).toBeNull()
	})
})
