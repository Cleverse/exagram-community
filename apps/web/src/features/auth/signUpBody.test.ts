import { describe, expect, it } from "vitest"

import { signUpBody } from "./signUpBody"

const account = { email: "ada@example.test", name: "Ada", password: "correct horse battery" }

describe("signUpBody", () => {
	it("sends no Workspace key when the edition has no Workspace fields", () => {
		const body = signUpBody(account, null)
		expect(body).toEqual(account)
		expect("workspaceName" in body).toBe(false)
	})

	it("adds the Workspace name the fields hold", () => {
		expect(signUpBody(account, { workspaceName: "Acme" })).toEqual({ ...account, workspaceName: "Acme" })
	})
})
