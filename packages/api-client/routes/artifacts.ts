import { type coreContract } from "@exagram/core/contract"
import { REFUSAL_TEXT } from "@exagram/core/utils/refusal"

import {
	type AnyoneSettingsPatch,
	type ArtifactKind,
	type ArtifactSearchHit,
	type CreatedArtifact,
	type DuplicatedArtifact,
	type GeneralAccess,
	type LibraryScope,
	type PublishPolicy,
	type Revision,
	type VisibleArtifact,
} from "../types"
import { Router } from "../utils/baseRouter"
import { failWith, failWithUserMessage, statusOf } from "../utils/errors"
import { unwrapResult } from "../utils/result"

/**
 * Withheld and never-existed are one outcome to the reader, so they are one sentence here — the same
 * sentence the server sends, not a second copy of it.
 */
export const ARTIFACT_UNAVAILABLE = REFUSAL_TEXT

export class ArtifactsRouter extends Router<typeof coreContract> {
	/**
	 * The server answers from `exagram.visible_artifacts(p_kind, p_id)` and writes the ledger rows
	 * for the read. `scope` narrows what it already resolved; it never widens it.
	 */
	async list(input: { scope: LibraryScope; kind?: ArtifactKind; projectId?: string }): Promise<VisibleArtifact[]> {
		try {
			return unwrapResult(await this.client.artifacts.list({ query: input })).items
		} catch (error) {
			return failWith(error, "Could not load your Artifacts")
		}
	}

	async get(input: { artifactId: string }): Promise<VisibleArtifact> {
		try {
			return unwrapResult(await this.client.artifacts.get({ params: { id: input.artifactId } }))
		} catch (error) {
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	/**
	 * Full text over the title and `extracted_text`, ranked, inside the same boundary as `list` —
	 * a hit is an Artifact this reader could already open. The server writes the ledger rows.
	 */
	async search(input: { q: string; projectId?: string; limit?: number }): Promise<ArtifactSearchHit[]> {
		try {
			return unwrapResult(await this.client.artifacts.search({ query: input })).items
		} catch (error) {
			return failWith(error, "Could not search your Artifacts")
		}
	}

	/** Creates the Artifact and the presigned PUT in one call; the bytes are not uploaded yet. */
	async create(input: {
		kind: ArtifactKind
		title: string
		projectId: string | null
		mime: string
		bytes: number
	}): Promise<CreatedArtifact> {
		try {
			return unwrapResult(await this.client.artifacts.create({ body: input }))
		} catch (error) {
			return failWith(error, "Could not start the upload")
		}
	}

	/** Turns an uploaded object into the Artifact's first Revision, which starts Pending. */
	async finalize(input: {
		artifactId: string
		storageKey: string
		sha256: string
		bytes: number
		note: string | null
	}): Promise<Revision> {
		try {
			const { artifactId, ...body } = input
			return unwrapResult(await this.client.artifacts.finalize({ params: { id: artifactId }, body }))
		} catch (error) {
			return failWith(error, "Could not finish the upload")
		}
	}

	/** Copies the Artifact server-side: no bytes cross the browser, whatever the source's kind. */
	async duplicate(input: { artifactId: string }): Promise<DuplicatedArtifact> {
		try {
			return unwrapResult(await this.client.artifacts.duplicate({ params: { id: input.artifactId } }))
		} catch (error) {
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	async move(input: { artifactId: string; projectId: string | null }): Promise<void> {
		try {
			await this.client.artifacts.move({
				params: { id: input.artifactId },
				body: { projectId: input.projectId },
			})
		} catch (error) {
			failWith(error, "Could not move the Artifact")
		}
	}

	async softDelete(input: { artifactId: string }): Promise<void> {
		try {
			await this.client.artifacts.softDelete({ params: { id: input.artifactId } })
		} catch (error) {
			failWith(error, "Could not delete the Artifact")
		}
	}

	/** Owner only. `null` clears the override so the Artifact follows its Project. */
	async setPublishPolicy(input: { artifactId: string; publishPolicy: PublishPolicy | null }): Promise<VisibleArtifact> {
		try {
			return unwrapResult(
				await this.client.artifacts.setPublishPolicy({
					params: { id: input.artifactId },
					body: { publishPolicy: input.publishPolicy },
				}),
			)
		} catch (error) {
			return failWith(error, "Could not change the publishing policy")
		}
	}

	async setGeneralAccess(input: { artifactId: string; generalAccess: GeneralAccess }): Promise<VisibleArtifact> {
		try {
			return unwrapResult(
				await this.client.artifacts.setGeneralAccess({
					params: { id: input.artifactId },
					body: { generalAccess: input.generalAccess },
				}),
			)
		} catch (error) {
			return failWith(error, "Could not change general access")
		}
	}

	/** Owner only. The server's 400s ("Set a password first.") are written for the person, so they come through. */
	async setAnyoneSettings(input: { artifactId: string } & AnyoneSettingsPatch): Promise<VisibleArtifact> {
		try {
			const { artifactId, ...body } = input
			return unwrapResult(await this.client.artifacts.setAnyoneSettings({ params: { id: artifactId }, body }))
		} catch (error) {
			return failWithUserMessage(error, "Could not save the link settings")
		}
	}

	/**
	 * Open to a signed-out reader. A right password sets the unlock cookie on the response. A wrong one keeps its
	 * `INCORRECT_PASSWORD` code on the error and a rate limit keeps its message. Everything else is the one refusal,
	 * so nothing the server says about an Artifact reaches someone who has not unlocked it.
	 */
	async unlock(input: { artifactId: string; password: string }): Promise<void> {
		try {
			await this.client.artifacts.unlock({ params: { id: input.artifactId }, body: { password: input.password } })
		} catch (error) {
			failWith(error, statusOf(error) === 429 && error instanceof Error ? error.message : ARTIFACT_UNAVAILABLE)
		}
	}

	async restore(input: { artifactId: string }): Promise<void> {
		try {
			await this.client.artifacts.restore({ params: { id: input.artifactId } })
		} catch (error) {
			failWith(error, "Could not restore the Artifact")
		}
	}
}
