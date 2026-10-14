import { useQuery } from "@tanstack/react-query"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

/**
 * `artifacts.get` resolves through `exagram.visible_artifact` and writes the ledger rows for the
 * read. `access` and `visibleRevisionId` come back from that same call, so the UI never decides who
 * owns what and never picks which Revision it is reading.
 */
export const useArtifact = (artifactId: string) =>
	useQuery({
		queryKey: QueryKeys.artifacts.get(artifactId),
		queryFn: () => apiClient.artifacts.get({ artifactId }),
	})

/**
 * The text a reader reads. `pending` names a Pending Revision by id (`useReadingRevision`), which the server
 * lets only its author and the Owner read; otherwise it is whatever the boundary resolves.
 */
export const useRevisionText = (artifactId: string, revisionId: string | null, enabled: boolean, pending = false) =>
	useQuery({
		queryKey: pending
			? QueryKeys.revisions.textAt(artifactId, revisionId ?? "")
			: QueryKeys.revisions.text(artifactId, revisionId),
		queryFn: () =>
			pending && revisionId !== null
				? apiClient.revisions.revisionText({ artifactId, revisionId })
				: apiClient.revisions.text({ artifactId }),
		enabled: enabled && revisionId !== null,
	})

/** A specific Revision's text, which only the Owner may read for an older or pending one (History → Compare). */
export const useRevisionTextAt = (artifactId: string, revisionId: string, enabled: boolean) =>
	useQuery({
		queryKey: QueryKeys.revisions.textAt(artifactId, revisionId),
		queryFn: () => apiClient.revisions.revisionText({ artifactId, revisionId }),
		enabled,
		// A Revision's bytes never change, so its text never goes stale.
		staleTime: Infinity,
	})

/**
 * The URL carries a 300 s HMAC token; refetch it rather than hold it across a long read. `pending`
 * mints it for that named Pending Revision, as `useRevisionText` reads one.
 */
export const useBodyToken = (artifactId: string, revisionId: string | null, enabled: boolean, pending = false) =>
	useQuery({
		queryKey: pending
			? QueryKeys.revisions.bodyTokenAt(artifactId, revisionId ?? "")
			: QueryKeys.revisions.bodyToken(artifactId, revisionId),
		queryFn: () =>
			pending && revisionId !== null
				? apiClient.revisions.bodyTokenAt({ artifactId, revisionId })
				: apiClient.revisions.bodyToken({ artifactId }),
		enabled: enabled && revisionId !== null,
		staleTime: 240_000,
	})

export const usePreviewToken = (artifactId: string, revisionId: string | null, enabled: boolean) =>
	useQuery({
		queryKey: QueryKeys.revisions.previewToken(artifactId, revisionId),
		queryFn: () => apiClient.revisions.previewToken({ artifactId }),
		enabled: enabled && revisionId !== null,
		staleTime: 240_000,
	})
