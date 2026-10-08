import { describe, expect, it } from "vitest"

import { type ApiError, failWith, failWithUserMessage, isApiError } from "./errors"

const orpcError = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code })

const thrownBy = (run: () => never): ApiError => {
	try {
		run()
	} catch (error) {
		if (isApiError(error)) return error
		throw error
	}
	throw new Error("did not throw")
}

describe("failWith", () => {
	it("keeps the caller's message for an ordinary failure", () => {
		const error = thrownBy(() =>
			failWith(orpcError(400, "BAD_REQUEST", "server detail"), "Could not invite that person"),
		)
		expect(error).toMatchObject({ status: 400, code: "BAD_REQUEST", message: "Could not invite that person" })
	})

	it.each([404, 403, 409])("keeps the caller's message when a %s carries the Personal rule code", (status) => {
		const error = thrownBy(() =>
			failWith(
				orpcError(status, "PERSONAL_RULE", "A Personal Workspace has no Collaborator role."),
				"That file is unavailable",
			),
		)
		expect(error).toMatchObject({ status, code: "PERSONAL_RULE", message: "That file is unavailable" })
	})

	it("keeps one message for a 404, so a refusal stays the same as not-found", () => {
		const error = thrownBy(() => failWith(orpcError(404, "NOT_FOUND", "no such file"), "That file is unavailable"))
		expect(error).toMatchObject({ status: 404, message: "That file is unavailable" })
	})

	it("passes a Personal Workspace rule's sentence through, since it tells the person what to change", () => {
		const sentence = "A Personal Workspace has no Collaborator role. Share as Viewer or Editor."
		const error = thrownBy(() => failWith(orpcError(400, "PERSONAL_RULE", sentence), "Could not invite that person"))
		expect(error).toMatchObject({ status: 400, code: "PERSONAL_RULE", message: sentence })
	})
})

describe("failWithUserMessage", () => {
	it("still passes a 400 message through", () => {
		const error = thrownBy(() => failWithUserMessage(orpcError(400, "PERSONAL_RULE", "No joining settings."), "Failed"))
		expect(error.message).toBe("No joining settings.")
	})
})
