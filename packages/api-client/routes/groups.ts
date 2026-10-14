import { type coreContract } from "@exagram/core/contract"

import { type AdminGroup, type GroupList } from "../types"
import { Router } from "../utils/baseRouter"
import { failWith, failWithUserMessage } from "../utils/errors"
import { unwrapResult } from "../utils/result"

export class GroupsRouter extends Router<typeof coreContract> {
	async list(): Promise<GroupList> {
		try {
			return unwrapResult(await this.client.groups.list({}))
		} catch (error) {
			return failWith(error, "Could not load groups")
		}
	}

	async create(input: { name: string; memberIds: string[] }): Promise<AdminGroup> {
		try {
			return unwrapResult(await this.client.groups.create({ body: input }))
		} catch (error) {
			return failWithUserMessage(error, "Could not save the group")
		}
	}

	async update(input: { id: string; name: string; memberIds: string[] }): Promise<AdminGroup> {
		try {
			return unwrapResult(
				await this.client.groups.update({
					params: { id: input.id },
					body: { name: input.name, memberIds: input.memberIds },
				}),
			)
		} catch (error) {
			return failWithUserMessage(error, "Could not save the group")
		}
	}

	async delete(input: { id: string }): Promise<{ id: string }> {
		try {
			return unwrapResult(await this.client.groups.delete({ params: { id: input.id } }))
		} catch (error) {
			return failWith(error, "Could not delete the group")
		}
	}
}
