import { ConflictError } from "@exagram/core/utils/errors"
import { ORPCError } from "@orpc/server"
import { describe, expect, it } from "vitest"

import { toClientError } from "./client-error"

describe("toClientError", () => {
	it("answers a database refusal for a Personal Workspace as a 400 with its sentence", () => {
		const raised = Object.assign(new Error("A Personal Workspace has no Publish Policy."), { code: "EXP01" })
		expect(toClientError(raised)).toMatchObject({
			code: "PERSONAL_RULE",
			status: 400,
			message: "A Personal Workspace has no Publish Policy.",
		})
	})

	it("keeps a DomainError's code and status", () => {
		expect(toClientError(new ConflictError("Taken."))).toMatchObject({
			code: "CONFLICT",
			status: 409,
			message: "Taken.",
		})
	})

	it("passes an ORPCError through", () => {
		const error = new ORPCError("UNAUTHORIZED")
		expect(toClientError(error)).toBe(error)
	})

	it("hides any other error behind a 500 with no message of its own", () => {
		const raised = Object.assign(new Error('relation "exagram.users" does not exist'), { code: "42P01" })
		const mapped = toClientError(raised)
		expect(mapped.code).toBe("INTERNAL_SERVER_ERROR")
		expect(mapped.message).not.toContain("relation")
	})
})
