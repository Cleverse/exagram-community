import { ORPCError } from "@orpc/client"
import { describe, expect, it, vi } from "vitest"

import type { coreContract } from "@exagram/core/contract"

import { GroupsRouter } from "./groups"

import type { ContractRouterClient } from "@orpc/contract"

const ID = "00000000-0000-4000-8000-000000000001"
const MEMBER = "00000000-0000-4000-8000-000000000002"
const GROUP = { id: ID, name: "Design", memberCount: 1, memberIds: [MEMBER] }

const routerWith = (groups: Record<string, unknown>) =>
	new GroupsRouter({ groups } as unknown as ContractRouterClient<typeof coreContract>)

const refusal = new ORPCError("NOT_FOUND", { status: 404, message: "detail that must not leak" })
const taken = new ORPCError("CONFLICT", { status: 409, message: "A group with that name already exists." })

describe("GroupsRouter", () => {
	it("sends the name and every member id on create and on update", async () => {
		const create = vi.fn().mockResolvedValue({ result: GROUP })
		const update = vi.fn().mockResolvedValue({ result: GROUP })
		const router = routerWith({ create, update })

		await expect(router.create({ name: "Design", memberIds: [MEMBER] })).resolves.toEqual(GROUP)
		await expect(router.update({ id: ID, name: "Design", memberIds: [MEMBER] })).resolves.toEqual(GROUP)

		expect(create).toHaveBeenCalledWith({ body: { name: "Design", memberIds: [MEMBER] } })
		expect(update).toHaveBeenCalledWith({ params: { id: ID }, body: { name: "Design", memberIds: [MEMBER] } })
	})

	it("lets a taken name through on a save and keeps a refusal to the generic message", async () => {
		const input = { name: "Design", memberIds: [MEMBER] }
		const conflict = routerWith({ create: () => Promise.reject(taken), update: () => Promise.reject(taken) })
		await expect(conflict.create(input)).rejects.toMatchObject({
			status: 409,
			message: "A group with that name already exists.",
		})
		await expect(conflict.update({ id: ID, ...input })).rejects.toMatchObject({
			status: 409,
			message: "A group with that name already exists.",
		})

		const refused = routerWith({ create: () => Promise.reject(refusal), update: () => Promise.reject(refusal) })
		await expect(refused.create(input)).rejects.toMatchObject({ status: 404, message: "Could not save the group" })
		await expect(refused.update({ id: ID, ...input })).rejects.toMatchObject({
			status: 404,
			message: "Could not save the group",
		})
	})

	it("keeps a failed list or delete to its generic message", async () => {
		const router = routerWith({ list: () => Promise.reject(refusal), delete: () => Promise.reject(taken) })
		await expect(router.list()).rejects.toMatchObject({ status: 404, message: "Could not load groups" })
		await expect(router.delete({ id: ID })).rejects.toMatchObject({
			status: 409,
			message: "Could not delete the group",
		})
	})

	it("reads an Admin's list with member ids and a Member's without", async () => {
		const admin = { view: "admin", items: [GROUP] }
		const member = { view: "member", items: [{ id: ID, name: "Design", memberCount: 1 }] }
		await expect(routerWith({ list: () => Promise.resolve({ result: admin }) }).list()).resolves.toEqual(admin)
		await expect(routerWith({ list: () => Promise.resolve({ result: member }) }).list()).resolves.toEqual(member)
	})
})
