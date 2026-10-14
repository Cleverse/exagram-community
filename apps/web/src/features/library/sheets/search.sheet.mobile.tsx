import { useEffect, useRef } from "react"
import { useLocation } from "react-router"

import { MobileFileRow, MobileProjectRow } from "@/components/mobile/rows"
import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { IconSearch } from "@/components/ui/icons"
import { usePendingRevisions } from "@/features/approvals/hooks/usePendingRevisions"
import { useMe } from "@/features/auth/hooks/useMe"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { useProjects } from "@/features/library/hooks/useProjects"
import { summarizeProjects } from "@/features/library/projectSummary"
import { useSearchModel } from "@/features/library/useSearchModel"
import { projectIdOf } from "@/routes/paths"

/** The drawer's rise is 340ms; focusing sooner would bring the keyboard up mid-slide. */
const FOCUS_DELAY_MS = 260
/** The phone lists seven recent files before anything is typed. */
const RECENT_COUNT = 7
/** A keyboard sends a change per letter; the server search waits for a pause. */
const DEBOUNCE_MS = 200

/**
 * The Search drawer: full height, a field that takes focus once the drawer has risen, then recent
 * files, or matching Projects and files once typed. The results are the desktop search's (`useSearchModel`),
 * drawn as the phone's own rows; a file's More steps into its File drawer with Back to these results.
 */
export default function SearchSheet() {
	const sheet = useSheet()
	const location = useLocation()
	const me = useMe()
	const everything = useArtifacts({ scope: "all" })
	const projects = useProjects()
	const pending = usePendingRevisions()
	const field = useRef<HTMLInputElement>(null)

	const artifacts = everything.data ?? []
	const projectList = projects.data ?? []
	const search = useSearchModel({
		artifacts,
		projects: projectList,
		projectId: projectIdOf(location.pathname),
		recentCount: RECENT_COUNT,
		debounceMs: DEBOUNCE_MS,
	})
	const { countFor, isShared } = summarizeProjects(projectList, artifacts, me.data?.id)
	const waiting = new Set((pending.data ?? []).map((revision) => revision.artifactId))

	useEffect(() => {
		const timer = setTimeout(() => field.current?.focus(), FOCUS_DELAY_MS)
		return () => clearTimeout(timer)
	}, [])

	return (
		<Sheet title="Search" full>
			<div style={{ padding: "4px 16px 8px" }}>
				<div
					className="flex items-center border border-ink"
					style={{ gap: 10, height: 44, padding: "0 12px", borderRadius: 6 }}
				>
					<IconSearch size={17} className="flex-none text-muted-2" />
					<input
						ref={field}
						type="search"
						aria-label="Search Workspace"
						placeholder="Search Workspace"
						value={search.query}
						onChange={(event) => search.setQuery(event.target.value)}
						enterKeyHint="search"
						className="min-w-0 flex-1 border-0 bg-transparent outline-none"
						// 16px keeps iOS Safari from zooming the page when the field takes focus.
						style={{ fontSize: 16, borderRadius: 0 }}
					/>
				</div>
			</div>

			<div style={{ padding: "0 6px 12px" }}>
				<div
					className="text-muted-2"
					aria-live="polite"
					style={{ padding: "8px 10px 4px", fontSize: 13, fontWeight: 500 }}
				>
					{search.label}
				</div>

				{search.results.map((result) =>
					result.kind === "project" ? (
						<MobileProjectRow
							key={result.key}
							projectId={result.project.id}
							name={result.name}
							count={countFor(result.project.id)}
							shared={isShared(result.project)}
						/>
					) : (
						<MobileFileRow
							key={result.key}
							artifact={result.artifact}
							projectName={result.artifact.projectId === null ? null : result.sub}
							pending={waiting.has(result.artifactId)}
							onMore={() => sheet.push("file", { artifactId: result.artifactId })}
						/>
					),
				)}

				{search.error === null ? null : (
					<div role="alert" className="text-danger" style={{ padding: "28px 10px", textAlign: "center", fontSize: 14 }}>
						{search.error}
					</div>
				)}

				{search.empty ? (
					<div className="text-muted" style={{ padding: "28px 10px", textAlign: "center", fontSize: 14 }}>
						No folders or files match that.
					</div>
				) : null}
			</div>
		</Sheet>
	)
}
