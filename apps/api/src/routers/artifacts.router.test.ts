import { hashUnlockToken } from "@exagram/core/services/unlock-token.service"
import { describe, expect, it } from "vitest"

import type { User } from "@exagram/core/entity/auth"

import { createRateCounter } from "../mcp/rate"

import { checkUnlockRate } from "./artifacts.router"
import { artifactId, build, mixedCase, otherId, owner } from "./artifacts.router.harness"

describe("GET /artifacts/{id} with a session", () => {
	it("reads as the session's user", async () => {
		const { get, clientFor } = build(createRateCounter(100))
		await expect(clientFor(owner).get({ params: { id: artifactId } })).resolves.toMatchObject({
			result: { id: artifactId },
		})
		expect(get).toHaveBeenCalledWith(
			{ kind: "user", id: owner.id, workspaceId: owner.workspaceId },
			artifactId,
			undefined,
		)
	})

	it("forwards the sha256 of this Artifact's unlock cookie and no other", async () => {
		const { get, clientFor } = build(createRateCounter(100))
		const cookie = `exagram_session=s; exagram_unlock_${otherId}=other; exagram_unlock_${artifactId}=the-cookie-value`
		await clientFor(owner, undefined, cookie).get({ params: { id: artifactId } })
		await clientFor(owner, undefined, `exagram_unlock_${otherId}=other`).get({ params: { id: artifactId } })
		expect(get.mock.calls.map((call) => call[2])).toEqual([hashUnlockToken("the-cookie-value"), undefined])
	})
})

describe("the Workspace a list or a search is of", () => {
	const inPersonal: User = { ...owner, workspaceId: "66666666-6666-4666-8666-666666666666" }

	it("hands the whole session user to the list, so it is of the Workspace the session acts in", async () => {
		const { list, clientFor } = build(createRateCounter(100))
		await clientFor(owner).list({ query: {} })
		await clientFor(inPersonal).list({ query: { scope: "mine" } })
		expect(list.mock.calls).toEqual([
			[owner, { scope: "all" }],
			[inPersonal, { scope: "mine" }],
		])
	})

	it("hands the session's Workspace to the search", async () => {
		const { search, clientFor } = build(createRateCounter(100))
		await clientFor(owner).search({ query: { q: "plan", limit: 20 } })
		await clientFor(inPersonal).search({ query: { q: "plan", projectId: artifactId, limit: 5 } })
		expect(search.mock.calls).toEqual([
			[
				{
					principalKind: "user",
					principalId: owner.id,
					surface: "web",
					workspaceId: owner.workspaceId,
					q: "plan",
					projectId: null,
					limit: 20,
				},
			],
			[
				{
					principalKind: "user",
					principalId: owner.id,
					surface: "web",
					workspaceId: inPersonal.workspaceId,
					q: "plan",
					projectId: artifactId,
					limit: 5,
				},
			],
		])
	})

	it("refuses a list or a search with no signed-in person before any usecase runs", async () => {
		const { list, search, clientFor } = build(createRateCounter(100))
		await expect(clientFor(null).list({ query: {} })).rejects.toMatchObject({ code: "UNAUTHORIZED" })
		await expect(clientFor(null).search({ query: { q: "plan", limit: 20 } })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		})
		expect(list).not.toHaveBeenCalled()
		expect(search).not.toHaveBeenCalled()
	})
})

describe("POST /artifacts/{id}/unlock (ADR 0044)", () => {
	it("trades a signed-in person's password for an HttpOnly, Lax, 24-hour cookie named for this Artifact", async () => {
		const { unlock, clientFor } = build(createRateCounter(100))
		const client = clientFor(owner)
		await expect(client.unlock({ params: { id: artifactId }, body: { password: "open sesame" } })).resolves.toEqual({
			result: { unlocked: true },
		})
		expect(unlock).toHaveBeenCalledWith(
			{ kind: "user", id: owner.id, workspaceId: owner.workspaceId },
			artifactId,
			"open sesame",
		)
		expect(client.resHeaders.get("set-cookie")).toBe(
			`exagram_unlock_${artifactId}=cookie-value; Path=/v1; HttpOnly; SameSite=Lax; Max-Age=86400`,
		)
	})

	it("states each budget in its refusal", () => {
		const ip = createRateCounter(1)
		const artifact = createRateCounter(1)
		expect(() => checkUnlockRate(ip, artifact, "203.0.113.7", artifactId)).not.toThrow()
		expect(() => checkUnlockRate(ip, artifact, "203.0.113.7", otherId)).toThrow("Unlocking is limited to 1 tries")
		expect(() => checkUnlockRate(ip, artifact, "198.51.100.9", artifactId)).toThrow(
			"Unlocking this file is limited to 1 tries",
		)
	})
})

describe("PATCH /artifacts/{id}/anyone-settings (ADR 0044)", () => {
	it("needs a signed-in person before anything runs", async () => {
		const { setSettings, clientFor } = build(createRateCounter(100))
		await expect(
			clientFor(null).setAnyoneSettings({ params: { id: artifactId }, body: { download: false } }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" })
		expect(setSettings).not.toHaveBeenCalled()
	})

	it("hands the usecase the person, the Artifact and only the fields the body names", async () => {
		const { setSettings, clientFor } = build(createRateCounter(100))
		await clientFor(owner).setAnyoneSettings({
			params: { id: artifactId },
			body: { passwordOn: true, password: "correct horse", expiresInDays: null },
		})
		expect(setSettings).toHaveBeenCalledWith(owner, {
			artifactId,
			passwordOn: true,
			password: "correct horse",
			expiresInDays: null,
		})
	})
})

describe("GET /artifacts/{id} signed out (ADR 0042)", () => {
	it("reads as the anonymous reader of that Artifact", async () => {
		const { get, clientFor } = build(createRateCounter(100))
		await expect(clientFor(null).get({ params: { id: artifactId } })).resolves.toMatchObject({
			result: { id: artifactId },
		})
		expect(get).toHaveBeenCalledWith({ kind: "anonymous", id: artifactId }, artifactId, undefined)
	})

	it("forwards the sha256 of this Artifact's unlock cookie and no other", async () => {
		const { get, duplicate, clientFor } = build(createRateCounter(100))
		const cookie = `exagram_session=s; exagram_unlock_${otherId}=other; exagram_unlock_${artifactId}=the-cookie-value`
		await clientFor(null, undefined, cookie).get({ params: { id: artifactId } })
		await clientFor(owner, undefined, cookie).get({ params: { id: artifactId } })
		await clientFor(null, undefined, `exagram_unlock_${otherId}=other`).get({ params: { id: artifactId } })
		expect(get.mock.calls.map((call) => call[2])).toEqual([
			hashUnlockToken("the-cookie-value"),
			hashUnlockToken("the-cookie-value"),
			undefined,
		])

		duplicate.mockResolvedValue({
			artifact: {
				id: otherId,
				workspaceId: owner.workspaceId,
				ownerId: owner.id,
				projectId: null,
				kind: "doc",
				title: "Plan (copy)",
				currentRevisionId: null,
				defaultPin: "latest",
				publishPolicy: null,
				generalAccess: "restricted",
				deletedAt: null,
				createdAt: new Date(),
			},
			revision: {
				id: "77777777-7777-4777-8777-777777777777",
				artifactId: otherId,
				seq: 1,
				status: "pending",
				authorUserId: owner.id,
				authorConnectionId: null,
				storageKey: "k",
				mime: "text/markdown",
				bytes: 1,
				sha256: "x",
				note: null,
				extractedText: null,
				extractionStatus: "none",
				createdAt: new Date(),
				approvedAt: null,
			},
		})
		await clientFor(owner, undefined, cookie).duplicate({ params: { id: artifactId } })
		expect(duplicate).toHaveBeenCalledWith(owner, {
			artifactId,
			unlockHash: hashUnlockToken("the-cookie-value"),
		})
	})

	it("refuses a signed-out burst from one address the same for any id, and never a session", async () => {
		const { get, clientFor } = build(createRateCounter(1))
		await expect(clientFor(null).get({ params: { id: artifactId } })).resolves.toBeDefined()
		await expect(clientFor(null).get({ params: { id: otherId } })).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
		})
		await expect(clientFor(null).get({ params: { id: artifactId } })).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
		})
		expect(get).toHaveBeenCalledTimes(1)
		await expect(clientFor(owner).get({ params: { id: otherId } })).resolves.toBeDefined()
		await expect(clientFor(null, "198.51.100.9").get({ params: { id: otherId } })).resolves.toBeDefined()
		expect(get).toHaveBeenCalledTimes(3)
	})
})

describe("POST /artifacts/{id}/unlock signed out (ADR 0044)", () => {
	it("trades the password for an HttpOnly, Lax, 24-hour cookie named for this Artifact", async () => {
		const { unlock, clientFor } = build(createRateCounter(100))
		const client = clientFor(null)
		await expect(client.unlock({ params: { id: artifactId }, body: { password: "open sesame" } })).resolves.toEqual({
			result: { unlocked: true },
		})
		expect(unlock).toHaveBeenCalledWith({ kind: "anonymous", id: artifactId }, artifactId, "open sesame")
		expect(client.resHeaders.get("set-cookie")).toBe(
			`exagram_unlock_${artifactId}=cookie-value; Path=/v1; HttpOnly; SameSite=Lax; Max-Age=86400`,
		)
	})

	it("marks the cookie Secure when the session cookie would be", async () => {
		const { clientFor } = build(createRateCounter(100), { secure: true })
		const client = clientFor(null)
		await client.unlock({ params: { id: artifactId }, body: { password: "open sesame" } })
		expect(client.resHeaders.get("set-cookie")).toMatch(/; Secure$/)
	})

	it("sets no cookie when the usecase refuses", async () => {
		const { unlock, clientFor } = build(createRateCounter(100))
		unlock.mockRejectedValue(new Error("Incorrect password. Try again."))
		const client = clientFor(null)
		await expect(client.unlock({ params: { id: artifactId }, body: { password: "nope" } })).rejects.toThrow()
		expect(client.resHeaders.get("set-cookie")).toBeNull()
	})

	it("takes both budgets before the usecase looks anything up", async () => {
		const { unlock, clientFor } = build(createRateCounter(100), { unlockPerIp: 2, unlockPerArtifact: 3 })
		const body = { password: "guess" }
		await clientFor(null, "203.0.113.7").unlock({ params: { id: artifactId }, body })
		await clientFor(null, "203.0.113.7").unlock({ params: { id: otherId }, body })
		await expect(clientFor(null, "203.0.113.7").unlock({ params: { id: artifactId }, body })).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
		})
		expect(unlock).toHaveBeenCalledTimes(2)

		await clientFor(null, "198.51.100.1").unlock({ params: { id: artifactId }, body })
		await clientFor(null, "198.51.100.2").unlock({ params: { id: artifactId }, body })
		await expect(clientFor(null, "198.51.100.3").unlock({ params: { id: artifactId }, body })).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
		})
		expect(unlock).toHaveBeenCalledTimes(4)
		await expect(clientFor(null, "198.51.100.3").unlock({ params: { id: otherId }, body })).resolves.toBeDefined()
	})

	it("counts every spelling of an id against one Artifact budget and sets the one cookie", async () => {
		const { unlock, clientFor } = build(createRateCounter(100), { unlockPerArtifact: 2 })
		const body = { password: "guess" }
		const lettered = "abcdef12-abcd-4abc-8abc-abcdefabcdef"
		await clientFor(null, "203.0.113.1").unlock({ params: { id: lettered }, body })
		const client = clientFor(null, "203.0.113.2")
		await client.unlock({ params: { id: mixedCase(lettered) }, body })
		await expect(
			clientFor(null, "203.0.113.3").unlock({ params: { id: lettered.toUpperCase() }, body }),
		).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" })
		expect(unlock).toHaveBeenCalledTimes(2)
		expect(client.resHeaders.get("set-cookie")).toMatch(new RegExp(`^exagram_unlock_${lettered}=`))
	})
})
