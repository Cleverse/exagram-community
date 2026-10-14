import { type Project, type VisibleArtifact } from "@exagram/api-client"
import { type ReactNode, useEffect } from "react"
import { useNavigate } from "react-router"

import { IconSearch } from "@/components/ui/icons"
import { TypeIcon } from "@/components/ui/TypeIcon"
import { SEARCH_LAYER } from "@/features/library/paneLayout"
import { type SearchResult, useSearchModel } from "@/features/library/useSearchModel"
import { macTabs } from "@/features/notifications/macBridge"

type Result = SearchResult & { icon: ReactNode }

const RECENT_COUNT = 8

const ResultRow = ({ result, onPick }: { result: Result; onPick: () => void }) => (
	<li>
		<button
			type="button"
			onClick={onPick}
			className="flex w-full items-center text-left hover:bg-ground"
			style={{ gap: 12, padding: "10px 12px" }}
		>
			{result.icon}
			<div className="min-w-0 flex-1">
				<div className="truncate" style={{ fontSize: 15, fontWeight: 500 }}>
					{result.name}
				</div>
				<div className="truncate" style={{ fontSize: 13, color: "var(--color-muted)", marginTop: 1 }}>
					{result.sub}
				</div>
			</div>
			<div className="flex-none whitespace-nowrap" style={{ fontSize: 13, color: "var(--color-muted)" }}>
				{result.activity}
			</div>
		</button>
	</li>
)

const FolderTile = () => <TypeIcon kind="folder" size={32} />

/**
 * The search overlay (design lines 1199–1225): a centred panel over a scrim, also opened by ⌘K / ⌘P. Empty,
 * it lists what was viewed lately, then the most recent files; typed into, it joins `artifacts.search` hits back to the visible list and
 * adds Projects whose name matches. Enter picks the first row, Escape closes.
 */
export const SearchDialog = ({
	artifacts,
	projects,
	projectId,
	onClose,
	onOpenArtifact,
}: {
	artifacts: VisibleArtifact[]
	projects: Project[]
	/** Set on a Project page to rank its contents before other Workspace results. */
	projectId?: string | null
	onClose: () => void
	/** A file pick: opens that Artifact's preview in full view, wherever the dialog was opened from. */
	onOpenArtifact: (artifactId: string) => void
}) => {
	const navigate = useNavigate()
	const search = useSearchModel({ artifacts, projects, projectId, recentCount: RECENT_COUNT })
	const { query, setQuery, trimmed } = search

	useEffect(() => {
		// On `document`, which hears the key before `window`, and claimed, so the preview's window-level
		// Escape (full view, then the pane) leaves an Escape meant for search alone.
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return
			event.preventDefault()
			onClose()
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [onClose])

	const results: Result[] = search.results.map((result) => ({
		...result,
		icon: result.kind === "project" ? <FolderTile /> : <TypeIcon kind={result.artifact.kind} size={32} />,
	}))

	const pick = (result: Result) => {
		onClose()
		if (result.kind === "project") void navigate(result.to)
		else onOpenArtifact(result.artifactId)
	}

	return (
		<div
			role="presentation"
			onClick={onClose}
			className="fixed inset-0 flex items-start justify-center"
			style={{ background: "var(--color-scrim)", zIndex: SEARCH_LAYER, padding: "88px 24px 24px" }}
		>
			<div
				role="dialog"
				aria-label="Search"
				onClick={(event) => event.stopPropagation()}
				className="flex w-full flex-col overflow-hidden bg-white"
				style={{
					maxWidth: 640,
					maxHeight: "calc(100vh - 112px)",
					borderRadius: "var(--radius-dialog)",
					boxShadow: "var(--shadow-dialog)",
				}}
			>
				<div
					className="flex flex-none items-center"
					style={{ gap: 12, padding: "0 18px", height: 60, borderBottom: "1px solid var(--color-line)" }}
				>
					<IconSearch size={18} className="flex-none text-muted-2" />
					<input
						type="search"
						autoFocus
						aria-label="Search Workspace"
						placeholder={macTabs() ? "Open in new tab…" : "Search Workspace"}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && results[0]) pick(results[0])
						}}
						className="min-w-0 flex-1 border-0 bg-transparent outline-none"
						style={{ fontSize: 17 }}
					/>
					<button
						type="button"
						onClick={onClose}
						className="font-mono flex-none"
						style={{
							fontSize: 11,
							color: "var(--color-muted)",
							border: "1px solid var(--color-line-soft)",
							padding: "3px 6px",
						}}
					>
						ESC
					</button>
				</div>
				<div className="flex-1 overflow-auto" style={{ padding: 8 }}>
					{trimmed === "" ? (
						<div
							className="font-mono uppercase"
							style={{ padding: "8px 12px 6px", fontSize: 11, letterSpacing: ".14em", color: "var(--color-muted)" }}
						>
							Recent
						</div>
					) : null}
					{search.error === null ? null : (
						<div
							role="alert"
							style={{ padding: "40px 20px", textAlign: "center", color: "var(--color-danger)", fontSize: 15 }}
						>
							{search.error}
						</div>
					)}
					{search.empty ? (
						<div style={{ padding: "40px 20px", textAlign: "center", color: "var(--color-muted)", fontSize: 15 }}>
							Nothing matches “{trimmed}”.
						</div>
					) : null}
					<ul>
						{results.map((result) => (
							<ResultRow key={result.key} result={result} onPick={() => pick(result)} />
						))}
					</ul>
				</div>
			</div>
		</div>
	)
}
