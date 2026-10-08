import { useMutation } from "@tanstack/react-query"
import { useCallback, useRef } from "react"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { kindForFile, sha256Hex, UPLOAD_MUTATION_KEY } from "@/features/library/upload"
import {
	discardDraft,
	runUpload,
	type UploadApi,
	type UploadDraft,
	type UploadResult,
	type UploadStep,
} from "@/features/library/uploadDraft"
import { useInvalidate } from "@/utils/react-query"

export type { UploadStep } from "@/features/library/uploadDraft"

const uploadApi: UploadApi = {
	createArtifact: (input) => apiClient.artifacts.create(input),
	createRevisionTicket: (input) => apiClient.revisions.createUploadTicket(input),
	finalizeArtifact: (input) => apiClient.artifacts.finalize(input),
	finalizeRevision: (input) => apiClient.revisions.finalize(input),
	put: async (ticket, file) => {
		// The presigned PUT signs these headers; sending others, or omitting one, voids it.
		const put = await fetch(ticket.url, { method: "PUT", body: file, headers: ticket.requiredHeaders })
		if (!put.ok) throw new Error("The upload did not reach storage — try again")
	},
	getArtifact: (artifactId) => apiClient.artifacts.get({ artifactId }),
	listPendingArtifactIds: async () => (await apiClient.approvals.listPending()).map((pending) => pending.artifactId),
	softDelete: (artifactId) => apiClient.artifacts.softDelete({ artifactId }),
}

/**
 * Two steps everywhere (§A.3): the ticket signs the size, the browser PUTs the bytes, and finalize
 * re-reads the object and inserts the Revision. It lands `pending` unless the server publishes it —
 * an Editor's new Revision is approved on arrival — so the caller reads `status` rather than assume.
 *
 * A failed new-Artifact upload keeps its Artifact as a draft (see `UploadDraft`), so trying again goes on
 * with it instead of creating another; `discard` deletes that Artifact, still empty, once the person gives
 * up (closes the dialog, or a drop that has no retry fails).
 */
export const useUpload = (onStep: (step: UploadStep) => void) => {
	const invalidate = useInvalidate()
	const draft = useRef<UploadDraft | null>(null)
	const inFlight = useRef<Promise<unknown> | null>(null)

	const mutation = useMutation({
		mutationKey: UPLOAD_MUTATION_KEY,
		mutationFn: async (input: {
			file: File
			title: string
			projectId: string | null
			artifactId: string | null
			note: string | null
		}): Promise<UploadResult> => {
			const detected = kindForFile(input.file.name)
			if (!detected) throw new Error("Exagram does not store this kind of file")

			const run = (async () => {
				// The server re-reads the object and compares this digest and the signed size.
				const sha256 = await sha256Hex(input.file)
				return runUpload(uploadApi, { ...input, ...detected }, sha256, {
					resuming: draft.current,
					onDraft: (next) => {
						draft.current = next
					},
					onStep,
				})
			})()
			inFlight.current = run
			try {
				return await run
			} finally {
				if (inFlight.current === run) inFlight.current = null
			}
		},
		onSuccess: (result) => {
			invalidate([
				QueryKeys.approvals.pending(),
				QueryKeys.artifacts.get(result.artifactId),
				QueryKeys.revisions.list(result.artifactId),
				["artifacts", "list"],
			])
		},
	})

	const discard = useCallback(async () => {
		// An attempt still running decides first: if it lands, there is nothing to discard.
		await inFlight.current?.catch(() => undefined)
		const abandoned = draft.current
		if (!abandoned) return
		draft.current = null
		if (await discardDraft(uploadApi, abandoned)) invalidate([["artifacts", "list"]])
	}, [invalidate])

	return { ...mutation, discard }
}
