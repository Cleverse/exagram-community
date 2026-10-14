import { type coreContract } from "@exagram/core/contract"

import { type ActivityPage, type ArtifactViewer, type LedgerPage } from "../types"
import { Router } from "../utils/baseRouter"
import { failWith } from "../utils/errors"
import { unwrapResult } from "../utils/result"

import { ARTIFACT_UNAVAILABLE } from "./artifacts"

export class LedgerRouter extends Router<typeof coreContract> {
	/** Owner only: every read of one Artifact, served and withheld alike. */
	async forArtifact(input: { artifactId: string; limit?: number; cursor?: string }): Promise<LedgerPage> {
		try {
			const { artifactId, ...query } = input
			return unwrapResult(await this.client.ledger.forArtifact({ params: { artifactId }, query }))
		} catch (error) {
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	/** Owner only: each person who has opened the Artifact, with their first and last open. */
	async viewers(input: { artifactId: string }): Promise<ArtifactViewer[]> {
		try {
			return unwrapResult(await this.client.ledger.viewers({ params: { artifactId: input.artifactId } })).items
		} catch (error) {
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	/** Admin only. */
	async activity(input: { limit?: number; cursor?: string }): Promise<ActivityPage> {
		try {
			return unwrapResult(await this.client.ledger.activity({ query: input }))
		} catch (error) {
			return failWith(error, "Could not load Activity")
		}
	}
}
