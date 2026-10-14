import { type coreContract } from "@exagram/core/contract"

import { type BodyToken, type PreviewToken, type Revision, type RevisionText, type UploadTicket } from "../types"
import { Router } from "../utils/baseRouter"
import { failWith, statusOf } from "../utils/errors"
import { unwrapResult } from "../utils/result"

import { ARTIFACT_UNAVAILABLE } from "./artifacts"

export class RevisionsRouter extends Router<typeof coreContract> {
	/** Owner only. A grantee gets the same refusal text as a stranger. */
	async list(input: { artifactId: string }): Promise<Revision[]> {
		try {
			return unwrapResult(await this.client.revisions.list({ params: input })).items
		} catch (error) {
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	/** The byte count is signed into the presigned PUT, so the browser cannot upload more. */
	async createUploadTicket(input: { artifactId: string; mime: string; bytes: number }): Promise<UploadTicket> {
		try {
			const { artifactId, ...body } = input
			return unwrapResult(await this.client.revisions.createUploadTicket({ params: { artifactId }, body }))
		} catch (error) {
			return failWith(error, "Could not start the upload")
		}
	}

	/** The server re-reads the object and checks the digest; a mismatch is refused, not stored. */
	async finalize(input: {
		artifactId: string
		storageKey: string
		sha256: string
		bytes: number
		note: string | null
	}): Promise<Revision> {
		try {
			const { artifactId, ...body } = input
			return unwrapResult(await this.client.revisions.finalize({ params: { artifactId }, body }))
		} catch (error) {
			return failWith(error, "Could not finish the upload")
		}
	}

	/** History is append-only: this writes a new Pending Revision equal to an old one. */
	async restoreAsNew(input: { artifactId: string; revisionId: string }): Promise<Revision> {
		try {
			return unwrapResult(await this.client.revisions.restoreAsNew({ params: input }))
		} catch (error) {
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	/**
	 * Mints the 300 s usercontent URL for the Revision the boundary resolved. There is no
	 * revision id to pass: asking for a particular one is exactly the re-derivation we forbid.
	 */
	async bodyToken(input: { artifactId: string }): Promise<BodyToken> {
		try {
			return unwrapResult(await this.client.revisions.bodyToken({ params: input }))
		} catch (error) {
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	/**
	 * The usercontent URL for one named Revision: the Owner's, or an author's own Pending one, so it can be
	 * read before it is approved. Anything else refuses like a stranger.
	 */
	async bodyTokenAt(input: { artifactId: string; revisionId: string }): Promise<BodyToken> {
		try {
			return unwrapResult(await this.client.revisions.bodyTokenAt({ params: input }))
		} catch (error) {
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	async previewToken(input: { artifactId: string }): Promise<PreviewToken> {
		try {
			return unwrapResult(await this.client.revisions.previewToken({ params: input }))
		} catch (error) {
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	/**
	 * A 400 — html served only from the usercontent origin, an image, extraction unavailable — is not
	 * a refusal, so its server message comes through for the reader to see.
	 */
	async text(input: { artifactId: string }): Promise<RevisionText> {
		try {
			return unwrapResult(await this.client.revisions.text({ params: input }))
		} catch (error) {
			if (statusOf(error) === 400 && error instanceof Error) return failWith(error, error.message)
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}

	/**
	 * One named Revision's text. Past the Revision the boundary serves, the Owner reads any Revision and an
	 * author their own Pending one; everything else refuses like a stranger (404, the one unavailable
	 * message). A 400 — an image, an HTML body, a file whose text is not extracted — is not a refusal, so
	 * its server message comes through for the reader to see.
	 */
	async revisionText(input: { artifactId: string; revisionId: string }): Promise<RevisionText> {
		try {
			return unwrapResult(await this.client.revisions.revisionText({ params: input }))
		} catch (error) {
			if (statusOf(error) === 400 && error instanceof Error) return failWith(error, error.message)
			return failWith(error, ARTIFACT_UNAVAILABLE)
		}
	}
}
