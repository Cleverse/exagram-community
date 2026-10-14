import { isApiError, type ArtifactKind, type RevisionStatus, type UploadTicket } from "@exagram/api-client"

export type UploadStep = "preparing" | "uploading" | "saving"

/** The calls an upload makes, so the steps are tested apart from the network. */
export type UploadApi = {
	createArtifact: (input: {
		title: string
		kind: ArtifactKind
		projectId: string | null
		mime: string
		bytes: number
	}) => Promise<{ ticket: UploadTicket }>
	createRevisionTicket: (input: { artifactId: string; mime: string; bytes: number }) => Promise<UploadTicket>
	finalizeArtifact: (input: FinalizeInput) => Promise<{ id: string; status: RevisionStatus }>
	finalizeRevision: (input: FinalizeInput) => Promise<{ id: string; status: RevisionStatus }>
	put: (ticket: UploadTicket, file: File) => Promise<void>
	getArtifact: (artifactId: string) => Promise<{ revisionSeq: number | null; visibleRevisionId: string | null }>
	listPendingArtifactIds: () => Promise<string[]>
	softDelete: (artifactId: string) => Promise<void>
}

type FinalizeInput = { artifactId: string; storageKey: string; sha256: string; bytes: number; note: string | null }

export type UploadInput = {
	file: File
	title: string
	projectId: string | null
	/** Set for a new Revision of an existing Artifact; null makes a new Artifact. */
	artifactId: string | null
	note: string | null
	kind: ArtifactKind
	mime: string
}

export type UploadResult = { artifactId: string; revisionId: string; status: RevisionStatus }

/**
 * What a failed new-Artifact upload already settled on the server, kept so trying again never creates a
 * second Artifact. `POST /artifacts` makes the row before any bytes move, so a PUT or finalize that fails
 * leaves an Artifact with no Revision. A retry of the same file, title and folder goes on with that
 * Artifact: it re-PUTs to the same ticket while it is valid, asks `/revisions/ticket` for a fresh one once
 * it is not, and only finalizes when the bytes already reached storage (finalize is idempotent per key).
 */
export type UploadDraft = {
	artifactId: string
	title: string
	projectId: string | null
	kind: ArtifactKind
	mime: string
	sha256: string
	bytes: number
	/** Null once the server refused the ticket's object at finalize: the next attempt asks for a fresh one. */
	ticket: { ticket: UploadTicket; issuedAt: number; fromCreate: boolean } | null
	/** The bytes reached storage under `ticket`, so a retry only finalizes. */
	stored: boolean
}

/** A ticket is not used within this long of its expiry: the PUT may take a while on a slow network. */
export const TICKET_EXPIRY_MARGIN_MS = 60_000

export const draftMatches = (draft: UploadDraft, input: UploadInput, sha256: string) =>
	draft.title === input.title &&
	draft.projectId === input.projectId &&
	draft.kind === input.kind &&
	draft.mime === input.mime &&
	draft.sha256 === sha256 &&
	draft.bytes === input.file.size

export const ticketUsable = (draft: UploadDraft, now: number) =>
	draft.ticket !== null &&
	now < draft.ticket.issuedAt + draft.ticket.ticket.expiresInSeconds * 1000 - TICKET_EXPIRY_MARGIN_MS

/**
 * Runs one attempt: create (or carry on with `resuming`), PUT, finalize. `onDraft` sees the draft each time
 * it changes, and null once there is nothing left to carry (finalized, or the Artifact is gone).
 */
export const runUpload = async (
	api: UploadApi,
	input: UploadInput,
	sha256: string,
	options: {
		resuming: UploadDraft | null
		onDraft: (draft: UploadDraft | null) => void
		onStep: (step: UploadStep) => void
		now?: () => number
	},
): Promise<UploadResult> => {
	const now = options.now ?? Date.now
	const { file } = input
	options.onStep("preparing")

	// A new Revision of an existing Artifact leaves nothing behind when it fails: no draft to carry.
	if (input.artifactId) {
		const ticket = await api.createRevisionTicket({ artifactId: input.artifactId, mime: input.mime, bytes: file.size })
		options.onStep("uploading")
		await api.put(ticket, file)
		options.onStep("saving")
		const finalized = await api.finalizeRevision({
			artifactId: input.artifactId,
			storageKey: ticket.storageKey,
			sha256,
			bytes: file.size,
			note: input.note,
		})
		return { artifactId: input.artifactId, revisionId: finalized.id, status: finalized.status }
	}

	let draft: UploadDraft
	const resuming = options.resuming
	if (resuming && draftMatches(resuming, input, sha256)) {
		draft = resuming
		if (!draft.stored && !ticketUsable(draft, now())) {
			const issuedAt = now()
			const ticket = await api.createRevisionTicket({
				artifactId: draft.artifactId,
				mime: input.mime,
				bytes: file.size,
			})
			draft = { ...draft, ticket: { ticket, issuedAt, fromCreate: false } }
			options.onDraft(draft)
		}
	} else {
		if (resuming) await discardDraft(api, resuming)
		const issuedAt = now()
		const created = await api.createArtifact({
			title: input.title,
			kind: input.kind,
			projectId: input.projectId,
			mime: input.mime,
			bytes: file.size,
		})
		draft = {
			artifactId: created.ticket.artifactId,
			title: input.title,
			projectId: input.projectId,
			kind: input.kind,
			mime: input.mime,
			sha256,
			bytes: file.size,
			ticket: { ticket: created.ticket, issuedAt, fromCreate: true },
			stored: false,
		}
		options.onDraft(draft)
	}

	const issued = draft.ticket
	if (!issued) throw new Error("The upload did not reach storage — try again")
	options.onStep("uploading")
	if (!draft.stored) {
		await api.put(issued.ticket, file)
		draft = { ...draft, stored: true }
		options.onDraft(draft)
	}

	options.onStep("saving")
	const finalizeInput = {
		artifactId: draft.artifactId,
		storageKey: issued.ticket.storageKey,
		sha256,
		bytes: file.size,
		note: input.note,
	}
	try {
		const finalized = issued.fromCreate
			? await api.finalizeArtifact(finalizeInput)
			: await api.finalizeRevision(finalizeInput)
		options.onDraft(null)
		return { artifactId: draft.artifactId, revisionId: finalized.id, status: finalized.status }
	} catch (error) {
		if (isApiError(error) && error.status === 404) {
			// The Artifact is gone (deleted elsewhere, or access lost): nothing left to carry on with.
			options.onDraft(null)
		} else if (isApiError(error) && error.status === 400) {
			// The server measured the object and refused it (missing, or not these bytes): PUT again under a
			// fresh ticket next time rather than finalizing the same key forever.
			options.onDraft({ ...draft, ticket: null, stored: false })
		}
		throw error
	}
}

/**
 * Soft-deletes a draft's Artifact when the person gives up on it, so no empty Artifact is left in Home and
 * the folder. Only one that still has no Revision goes: a finalize whose answer was lost may have landed,
 * and that upload is the person's to keep. Emptiness is decided only with reads the uploader may make —
 * never the Revision list, which is Owner-only and ledgers a Withheld read for anyone else. Best effort: a
 * failure here leaves only what the failed upload already left. Returns whether it deleted.
 */
export const discardDraft = async (api: UploadApi, draft: UploadDraft): Promise<boolean> => {
	try {
		const artifact = await api.getArtifact(draft.artifactId)
		if (artifact.revisionSeq !== null || artifact.visibleRevisionId !== null) return false
		const pending = await api.listPendingArtifactIds()
		if (pending.includes(draft.artifactId)) return false
		await api.softDelete(draft.artifactId)
		return true
	} catch {
		return false
	}
}
