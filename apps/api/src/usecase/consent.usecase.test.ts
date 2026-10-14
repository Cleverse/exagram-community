import { ConsentInteractionGoneError } from "@exagram/core/utils/errors"
import { errors } from "oidc-provider"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { resetOAuthEnv } from "../oauth/oauth.env"

import { ConsentUsecase } from "./consent.usecase"

// `mcpResource()` reads `API_ORIGIN` lazily; the global vitest env (vitest.config.ts) does not set
// it, so this test supplies it itself, the same way `oauth.env.test.ts` does.
Object.assign(process.env, { API_ORIGIN: "https://exagram.example" })
afterEach(() => resetOAuthEnv())

const raw = { req: {}, res: {} } as never

const grant = {
	addOIDCScope: vi.fn(),
	addResourceScope: vi.fn(),
	rejectOIDCScope: vi.fn(),
	rejectResourceScope: vi.fn(),
	save: vi.fn(function (this: { jti: string }) {
		return this.jti
	}),
}

let interactionUid = "interaction-1"
const interactionResult = vi.fn<
	(req: unknown, res: unknown, outcome: { consent?: { grantId: string } }) => string | Promise<string>
>(() => "http://localhost:5173/oauth/auth/abc")
/** The grant id the last approval told oidc-provider the browser may resume with. */
const answeredGrantId = () => interactionResult.mock.calls.at(-1)![2].consent!.grantId

const provider = (scope = "openid read write") => ({
	interactionDetails: vi.fn(() => ({
		uid: interactionUid,
		params: { client_id: "c1", resource: "http://localhost:5173/mcp", scope },
	})),
	interactionResult,
	Client: { find: vi.fn(() => ({ clientName: "Claude Desktop" })) },
	Grant: class {
		jti = ""
		addOIDCScope = grant.addOIDCScope
		addResourceScope = grant.addResourceScope
		rejectOIDCScope = grant.rejectOIDCScope
		rejectResourceScope = grant.rejectResourceScope
		save = grant.save
	},
})

const TEAM = { id: "11111111-1111-4111-8111-111111111111", kind: "team", name: "Acme" }
const PERSONAL = { id: "22222222-2222-4222-8222-222222222222", kind: "personal", name: "Personal" }
const person = { id: "user-1", workspaceId: TEAM.id }

const connections = {
	upsert: vi.fn((): object | null => ({ id: "connection-1" })),
	findLiveByUserAndClient: vi.fn(
		(): { oidcGrantId: string; folderAccess?: "all" | "named"; workspaceId?: string } | null => null,
	),
	listConsentWorkspaces: vi.fn(() => [PERSONAL, TEAM]),
}
const grants = { revokeGrant: vi.fn(() => undefined) }

const usecase = (scope?: string) =>
	new ConsentUsecase(provider(scope) as never, connections as never, grants as never, ["read", "write"])

beforeEach(() => {
	interactionUid = "interaction-1"
	interactionResult.mockReset().mockReturnValue("http://localhost:5173/oauth/auth/abc")
	connections.findLiveByUserAndClient.mockReset().mockReturnValue(null)
	connections.listConsentWorkspaces.mockReset().mockReturnValue([PERSONAL, TEAM])
	connections.upsert.mockReset().mockReturnValue({ id: "connection-1" })
})

describe("ConsentUsecase", () => {
	it("offers only the Scopes the client requested, intersected with what the server allows", async () => {
		await expect(usecase("openid read").info(raw, "u1", person)).resolves.toEqual({
			uid: "u1",
			clientName: "Claude Desktop",
			scopes: ["read"],
			resource: "http://localhost:5173/mcp",
			hasNamedFolderAccess: false,
			defaultWorkspaceId: TEAM.id,
			currentConnectionWorkspaceId: null,
			workspaces: [PERSONAL, TEAM],
		})
		expect(connections.findLiveByUserAndClient).toHaveBeenCalledWith("user-1", "c1")
	})

	it("defaults to the person's current Workspace and lists every one they may pick", async () => {
		await expect(usecase().info(raw, "u1", { ...person, workspaceId: PERSONAL.id })).resolves.toMatchObject({
			defaultWorkspaceId: PERSONAL.id,
			workspaces: [PERSONAL, TEAM],
		})
	})

	it("names the Workspace the client's live Connection is bound to, so a move can be told from a renewal", async () => {
		connections.findLiveByUserAndClient.mockReturnValueOnce({
			oidcGrantId: "grant-0",
			folderAccess: "all",
			workspaceId: PERSONAL.id,
		})
		await expect(usecase().info(raw, "u1", person)).resolves.toMatchObject({
			defaultWorkspaceId: TEAM.id,
			currentConnectionWorkspaceId: PERSONAL.id,
		})
	})

	it("reports a live named Connection when the client reconnects", async () => {
		connections.findLiveByUserAndClient.mockReturnValueOnce({ oidcGrantId: "grant-0", folderAccess: "named" })
		await expect(usecase().info(raw, "u1", person)).resolves.toMatchObject({
			hasNamedFolderAccess: true,
		})
	})

	it("reports broad reach for a live Connection with all folders", async () => {
		connections.findLiveByUserAndClient.mockReturnValueOnce({ oidcGrantId: "grant-0", folderAccess: "all" })
		await expect(usecase().info(raw, "u1", person)).resolves.toMatchObject({
			hasNamedFolderAccess: false,
		})
	})

	it("refuses a scope the server does not issue", async () => {
		await expect(usecase().approve(raw, person, { name: "x", scopes: ["manage"] })).rejects.toThrow(/scope/)
	})

	it("refuses a scope the client never requested", async () => {
		await expect(usecase("openid read").approve(raw, person, { name: "x", scopes: ["read", "write"] })).rejects.toThrow(
			/not requested/,
		)
	})

	it("records the connection and answers with the url to return to", async () => {
		await expect(usecase().approve(raw, person, { name: "Claude", scopes: ["read"] })).resolves.toEqual({
			redirectTo: "http://localhost:5173/oauth/auth/abc",
		})
		expect(connections.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "user-1", oidcGrantId: answeredGrantId(), workspaceId: TEAM.id }),
		)
	})

	it("mints the same grant for one person and interaction however often it is allowed, and another for the next interaction or person", async () => {
		await usecase().approve(raw, person, { name: "Claude", scopes: ["read"] })
		await usecase().approve(raw, person, { name: "Claude", scopes: ["read"] })
		interactionUid = "interaction-2"
		await usecase().approve(raw, person, { name: "Claude", scopes: ["read"] })
		interactionUid = "interaction-1"
		await usecase().approve(raw, { ...person, id: "user-2" }, { name: "Claude", scopes: ["read"] })

		const answered = interactionResult.mock.calls.map((call) => call[2].consent!.grantId)
		const bound = connections.upsert.mock.calls.map(
			(call) => (call as unknown as [{ oidcGrantId: string }])[0].oidcGrantId,
		)
		expect(answered[1]).toBe(answered[0])
		expect(answered[2]).not.toBe(answered[0])
		expect(answered[3]).not.toBe(answered[0])
		expect(bound).toEqual(answered)
	})

	it("answers the interaction before it saves the grant or binds the Connection", async () => {
		const calls: string[] = []
		interactionResult.mockImplementationOnce(() => {
			calls.push("answer")
			return "http://localhost:5173/oauth/auth/abc"
		})
		grant.save.mockImplementationOnce(function (this: { jti: string }) {
			calls.push("save")
			return this.jti
		})
		connections.upsert.mockImplementationOnce(() => {
			calls.push("upsert")
			return { id: "connection-1" }
		})
		await usecase().approve(raw, person, { name: "Claude", scopes: ["read"] })
		expect(calls).toEqual(["answer", "save", "upsert"])
	})

	it("binds and revokes nothing when the interaction ends between its read and its answer", async () => {
		grant.save.mockClear()
		grants.revokeGrant.mockClear()
		connections.findLiveByUserAndClient.mockReturnValue({ oidcGrantId: "delivered-grant" })
		interactionResult.mockRejectedValueOnce(new errors.SessionNotFound("interaction session id cookie not found"))

		const answer = usecase().approve(raw, person, { name: "Claude", scopes: ["read"] })
		await expect(answer).rejects.toBeInstanceOf(ConsentInteractionGoneError)
		expect(grant.save).not.toHaveBeenCalled()
		expect(connections.upsert).not.toHaveBeenCalled()
		expect(grants.revokeGrant).not.toHaveBeenCalled()
	})

	it("binds the Connection to the Workspace the person picked", async () => {
		await usecase().approve(raw, person, { name: "Claude", scopes: ["read"], workspaceId: PERSONAL.id })
		expect(connections.upsert).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: PERSONAL.id }))
	})

	it("refuses a Workspace the person is not in, the same for a foreign id and a made-up one", async () => {
		grant.save.mockClear()
		const foreign = "33333333-3333-4333-8333-333333333333"
		const made = "44444444-4444-4444-8444-444444444444"
		const answers = await Promise.all(
			[foreign, made].map((workspaceId) =>
				usecase()
					.approve(raw, person, { name: "Claude", scopes: ["read"], workspaceId })
					.then(
						() => "approved",
						(error: Error) => error.message,
					),
			),
		)
		expect(answers[0]).toBe("No workspace with that id is available.")
		expect(answers[1]).toBe(answers[0])
		expect(grant.save).not.toHaveBeenCalled()
		expect(connections.upsert).not.toHaveBeenCalled()
	})

	it("destroys the grant it just saved when the person left the Workspace before the write", async () => {
		grants.revokeGrant.mockClear()
		connections.upsert.mockReturnValueOnce(null)
		await expect(usecase().approve(raw, person, { name: "Claude", scopes: ["read"] })).rejects.toThrow(
			"No workspace with that id is available.",
		)
		expect(grants.revokeGrant).toHaveBeenCalledWith(answeredGrantId())
	})

	it("rejects the requested scopes the owner withheld, so the prompt is not raised again", async () => {
		grant.rejectOIDCScope.mockClear()
		grant.rejectResourceScope.mockClear()
		await usecase().approve(raw, person, { name: "Claude", scopes: ["read"] })
		expect(grant.addResourceScope).toHaveBeenCalledWith("https://exagram.example/mcp", "read")
		expect(grant.rejectOIDCScope).toHaveBeenCalledWith("write")
		expect(grant.rejectResourceScope).toHaveBeenCalledWith("https://exagram.example/mcp", "write")
	})

	it("rejects nothing when the owner granted everything the client asked for", async () => {
		grant.rejectOIDCScope.mockClear()
		grant.rejectResourceScope.mockClear()
		await usecase().approve(raw, person, { name: "Claude", scopes: ["read", "write"] })
		expect(grant.rejectOIDCScope).not.toHaveBeenCalled()
		expect(grant.rejectResourceScope).not.toHaveBeenCalled()
	})

	it("revokes nothing on first-time consent", async () => {
		grants.revokeGrant.mockClear()
		connections.findLiveByUserAndClient.mockReturnValueOnce(null)
		await usecase().approve(raw, person, { name: "Claude", scopes: ["read"] })
		expect(grants.revokeGrant).not.toHaveBeenCalled()
	})

	it("revokes the superseded grant on re-consent, after the connection is upserted", async () => {
		grants.revokeGrant.mockClear()
		const calls: string[] = []
		connections.upsert.mockImplementationOnce(() => {
			calls.push("upsert")
			return { id: "connection-1" }
		})
		grants.revokeGrant.mockImplementationOnce(() => {
			calls.push("revoke")
		})
		connections.findLiveByUserAndClient.mockReturnValueOnce({ oidcGrantId: "grant-0" })
		await usecase().approve(raw, person, { name: "Claude", scopes: ["read"] })
		expect(grants.revokeGrant).toHaveBeenCalledWith("grant-0")
		expect(calls).toEqual(["upsert", "revoke"])
	})

	it("revokes nothing when the previous grant id happens to equal the new one", async () => {
		grants.revokeGrant.mockClear()
		connections.findLiveByUserAndClient.mockImplementationOnce(() => ({ oidcGrantId: answeredGrantId() }))
		await usecase().approve(raw, person, { name: "Claude", scopes: ["read"] })
		expect(grants.revokeGrant).not.toHaveBeenCalled()
	})

	it("answers a denial with a url too, and writes no connection", async () => {
		connections.upsert.mockClear()
		await expect(usecase().deny(raw)).resolves.toEqual({
			redirectTo: "http://localhost:5173/oauth/auth/abc",
		})
		expect(connections.upsert).not.toHaveBeenCalled()
	})

	it("answers a gone interaction with one expired error that keeps the provider's reason, and binds nothing", async () => {
		grant.save.mockClear()
		connections.upsert.mockClear()
		const gone = new errors.SessionNotFound("interaction session id cookie not found")
		const lost = new ConsentUsecase(
			{
				interactionDetails: vi.fn(() => Promise.reject(gone)),
				interactionResult: vi.fn(() => Promise.reject(gone)),
			} as never,
			connections as never,
			grants as never,
			["read", "write"],
		)
		const answers = [
			lost.info(raw, "u1", person),
			lost.approve(raw, person, { name: "Claude", scopes: ["read"] }),
			lost.deny(raw),
		]
		for (const answer of answers) {
			await expect(answer).rejects.toBeInstanceOf(ConsentInteractionGoneError)
			await expect(answer).rejects.toMatchObject({ reason: "interaction session id cookie not found", cause: gone })
		}
		expect(grant.save).not.toHaveBeenCalled()
		expect(connections.upsert).not.toHaveBeenCalled()
	})
})
