import { type VisibleArtifact } from "@exagram/api-client"
import { useCallback, useMemo } from "react"

import { edition } from "@/edition/edition"
import { recapFileOf, recapProjectOf } from "@/features/context/fromArtifacts"
import { ageInDays, inWeek, SAMPLE_TODAY } from "@/features/context/recap"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { useProjects } from "@/features/library/hooks/useProjects"
import { tickNow, useNow } from "@/utils/useNow"

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

/** How many of these artifacts were updated in week `week` back from `today`. */
export const weekCount = (artifacts: VisibleArtifact[], week: number, today: Date) =>
	artifacts.filter((artifact) => inWeek(ageInDays(recapFileOf(artifact, today).updated), week)).length

/**
 * What the recap reads, shared by the Context page and the sidebar's week list so both count the same
 * rows against the same clock. It is `ready` once both the library and its Projects have answered (a later
 * background refetch that fails keeps the rows on screen and sets `stale`); until then it is `pending`, or
 * `error` when either first read failed, and there are real week dates and nothing else. The design's sample,
 * in an edition that has one, stands in only once the library has loaded and is empty, so it never flashes
 * over a workspace that has files. Days roll over at local midnight on the shared clock, and a rebuild moves the clock too.
 */
export const useRecapSource = () => {
	const artifacts = useArtifacts({ scope: "all" })
	const projectList = useProjects()
	const sample = edition.recapSample
	const sampleFiles = useMemo(() => sample?.files() ?? [], [sample])

	const now = useNow()
	// Rows are aged in whole days, so they are rebuilt when the day changes, not on every minute's tick.
	const dayKey = startOfDay(now).getTime()
	const today = useMemo(() => new Date(dayKey), [dayKey])
	const rowFiles = useMemo(
		() => (artifacts.data ?? []).map((artifact) => recapFileOf(artifact, today)),
		[artifacts.data, today],
	)

	const loaded = artifacts.data !== undefined && projectList.data !== undefined
	const status = loaded ? "ready" : artifacts.isError || projectList.isError ? "error" : "pending"
	const onSample = sample !== null && loaded && rowFiles.length === 0
	const projects = useMemo(
		() => [...(onSample && sample !== null ? sample.projects() : []), ...(projectList.data ?? []).map(recapProjectOf)],
		[onSample, sample, projectList.data],
	)

	const refetchArtifacts = artifacts.refetch
	const refetchProjects = projectList.refetch
	/**
	 * Re-reads the library and its Projects, which is all a rebuilt summary needs (it is computed here), and
	 * moves the clock. Resolves to the re-read library, or throws the read's error.
	 */
	const refresh = useCallback(async () => {
		tickNow()
		const [nextArtifacts, nextProjects] = await Promise.all([refetchArtifacts(), refetchProjects()])
		const failed = nextArtifacts.error ?? nextProjects.error
		if (failed) throw failed
		return nextArtifacts.data ?? []
	}, [refetchArtifacts, refetchProjects])

	return {
		status,
		error: artifacts.error ?? projectList.error,
		/** A background re-read failed; what is shown is the last good read. */
		stale: loaded && (artifacts.isError || projectList.isError),
		/** Drives the summary band: the reader's own files, or the design's sample while the library is empty. */
		files: onSample ? sampleFiles : rowFiles,
		projects,
		/** The rows the list groups, or `undefined` while the sample stands in. Empty until `status` is ready. */
		rowFiles: onSample ? undefined : rowFiles,
		today: onSample ? SAMPLE_TODAY : today,
		now,
		onSample,
		refresh,
	}
}
