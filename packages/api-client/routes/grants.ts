import { type coreContract } from "@exagram/core/contract"

import { type Access, type DefaultPin, type Grant, type GrantRole, type InviteSuggestion } from "../types"
import { Router } from "../utils/baseRouter"
import { failWith } from "../utils/errors"
import { unwrapResult } from "../utils/result"

import { ARTIFACT_UNAVAILABLE } from "./artifacts"

export class GrantsRouter extends Router<typeof coreContract> {
	/** Owner, Editor or Collaborator. Exactly one of `artifactId` and `projectId`, which the contract enforces. */
	async list(input: { artifactId: string } | { projectId: string }): Promise<Grant[]> {
		try {
			return unwrapResult(await this.client.grants.list({ query: input })).items
		} catch (error) {
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	/** The caller's own access on the target; null when they have none. */
	async access(input: { artifactId: string } | { projectId: string }): Promise<Access | null> {
		try {
			return unwrapResult(await this.client.grants.access({ query: input })).access
		} catch (error) {
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	/** Workspace members not yet on the target; the same people who may invite may ask. */
	async suggestions(
		input: ({ artifactId: string } | { projectId: string }) & { q?: string; limit?: number },
	): Promise<InviteSuggestion[]> {
		try {
			return unwrapResult(await this.client.grants.suggestions({ query: input })).items
		} catch (error) {
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	/** `pinnedRevisionId` is the Owner's, for an Artifact: null follows latest, omitted takes the Default Pin. */
	async create(
		input: ({ artifactId: string } | { projectId: string }) & {
			granteeEmail: string
			role: GrantRole
			pinnedRevisionId?: string | null
		},
	): Promise<Grant> {
		try {
			return unwrapResult(await this.client.grants.create({ body: input }))
		} catch (error) {
			return failWith(error, "Could not invite that person")
		}
	}

	async updateRole(input: { grantId: string; role: GrantRole }): Promise<Grant> {
		try {
			return unwrapResult(
				await this.client.grants.updateRole({ params: { id: input.grantId }, body: { role: input.role } }),
			)
		} catch (error) {
			return failWith(error, "Could not change the role")
		}
	}

	/** `pinnedRevisionId: null` means the Grant follows the Current Revision instead of a Pin. */
	async updatePin(input: { grantId: string; pinnedRevisionId: string | null }): Promise<Grant> {
		try {
			return unwrapResult(
				await this.client.grants.updatePin({
					params: { id: input.grantId },
					body: { pinnedRevisionId: input.pinnedRevisionId },
				}),
			)
		} catch (error) {
			return failWith(error, "Could not change the Pin")
		}
	}

	async remove(input: { grantId: string }): Promise<{ id: string }> {
		try {
			return unwrapResult(await this.client.grants.remove({ params: { id: input.grantId } }))
		} catch (error) {
			return failWith(error, "Could not remove that person")
		}
	}

	async setDefaultPin(input: { artifactId: string; defaultPin: DefaultPin }): Promise<DefaultPin> {
		try {
			return unwrapResult(
				await this.client.grants.setDefaultPin({
					params: { artifactId: input.artifactId },
					body: { defaultPin: input.defaultPin },
				}),
			).defaultPin
		} catch (error) {
			return failWith(error, "Could not change the Default Pin")
		}
	}
}
