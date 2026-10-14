import { OidcPayloadsRepository } from "@exagram/core/repository/postgres/oidc-payloads.repository"
import { withDb } from "@exagram/core/test/pg"
import { errors } from "oidc-provider"
import { describe, expect, it } from "vitest"

import { createOidcAdapterFactory } from "./oidc.adapter"

describe("oidc adapter (integration)", () => {
	it("round-trips, consumes, expires and revokes by grant id", async () => {
		await withDb(async (sql) => {
			const Adapter = createOidcAdapterFactory(new OidcPayloadsRepository(sql), async () => {})
			const codes = new Adapter("AuthorizationCode")

			await codes.upsert("c1", { jti: "c1", grantId: "g1", uid: "u1" }, 600)
			expect(await codes.find("c1")).toMatchObject({ jti: "c1" })
			expect(await codes.findByUid("u1")).toMatchObject({ jti: "c1" })

			await codes.consume("c1")
			expect(await codes.find("c1")).toMatchObject({ consumed: true })

			await codes.upsert("c2", { jti: "c2", grantId: "g1" }, -1)
			expect(await codes.find("c2")).toBeUndefined()

			await codes.revokeByGrantId("g1")
			expect(await codes.find("c1")).toBeUndefined()
		})
	})

	it("lets exactly one caller consume a row; the repeat gets false and the adapter throws invalid_grant", async () => {
		await withDb(async (sql) => {
			const repository = new OidcPayloadsRepository(sql)
			const Adapter = createOidcAdapterFactory(repository, async () => {})
			const tokens = new Adapter("RefreshToken")

			await tokens.upsert("r1", { jti: "r1", grantId: "g1" }, 600)
			expect(await repository.consume("RefreshToken", "r1")).toBe(true)
			expect(await repository.consume("RefreshToken", "r1")).toBe(false)
			await expect(tokens.consume("r1")).rejects.toBeInstanceOf(errors.InvalidGrant)

			await tokens.upsert("r2", { jti: "r2", grantId: "g1" }, 600)
			await tokens.consume("r2")
			await expect(tokens.consume("r2")).rejects.toBeInstanceOf(errors.InvalidGrant)
			expect(await tokens.find("r2")).toBeUndefined()
		})
	})

	it("revokes the whole grant, Grant row included, when a consume loses the race", async () => {
		await withDb(async (sql) => {
			const repository = new OidcPayloadsRepository(sql)
			const Adapter = createOidcAdapterFactory(repository, async () => {})
			const tokens = new Adapter("RefreshToken")

			await new Adapter("Grant").upsert("g1", { jti: "g1" }, 600)
			await new Adapter("AccessToken").upsert("a1", { jti: "a1", grantId: "g1" }, 600)
			await tokens.upsert("r1", { jti: "r1", grantId: "g1" }, 600)
			await tokens.upsert("r2", { jti: "r2", grantId: "g1" }, 600)
			await new Adapter("Grant").upsert("g2", { jti: "g2" }, 600)
			await tokens.upsert("other", { jti: "other", grantId: "g2" }, 600)

			await tokens.consume("r1")
			await expect(tokens.consume("r1")).rejects.toBeInstanceOf(errors.InvalidGrant)

			expect(await new Adapter("Grant").find("g1")).toBeUndefined()
			expect(await new Adapter("AccessToken").find("a1")).toBeUndefined()
			expect(await tokens.find("r1")).toBeUndefined()
			expect(await tokens.find("r2")).toBeUndefined()
			expect(await new Adapter("Grant").find("g2")).toBeDefined()
			expect(await tokens.find("other")).toBeDefined()
		})
	})
	it("revokeGrant removes the Grant row and its tokens and nothing of another grant", async () => {
		await withDb(async (sql) => {
			const repository = new OidcPayloadsRepository(sql)
			const Adapter = createOidcAdapterFactory(repository, async () => {})

			await new Adapter("Grant").upsert("g1", { jti: "g1" }, 600)
			await new Adapter("AccessToken").upsert("a1", { jti: "a1", grantId: "g1" }, 600)
			await new Adapter("RefreshToken").upsert("r1", { jti: "r1", grantId: "g1" }, 600)
			await new Adapter("Grant").upsert("g2", { jti: "g2" }, 600)
			await new Adapter("RefreshToken").upsert("r2", { jti: "r2", grantId: "g2" }, 600)

			await repository.revokeGrant("g1")

			expect(await new Adapter("Grant").find("g1")).toBeUndefined()
			expect(await new Adapter("AccessToken").find("a1")).toBeUndefined()
			expect(await new Adapter("RefreshToken").find("r1")).toBeUndefined()
			expect(await new Adapter("Grant").find("g2")).toBeDefined()
			expect(await new Adapter("RefreshToken").find("r2")).toBeDefined()
		})
	})
})
