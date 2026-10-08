import { type Project, type VisibleArtifact } from "@exagram/api-client"
import { useEffect, useState } from "react"

import { ageLabel } from "@/features/artifact/reading/format"
import { useArtifactSearch } from "@/features/library/hooks/useArtifacts"
import { useRecentViews } from "@/features/library/recentlyViewed"
import { paths } from "@/routes/paths"

export type SearchResult =
	| { key: string; kind: "project"; project: Project; name: string; sub: string; activity: string; to: string }
	| {
			key: string
			kind: "file"
			artifact: VisibleArtifact
			name: string
			sub: string
			activity: string
			artifactId: string
	  }

/**
 * What search shows, whoever draws it: the desktop overlay and the phone's Search drawer. Empty, it lists what
 * this person viewed lately (files and Projects), topped up with the most recently updated files; typed into, it joins `artifacts.search` hits back to the visible list and adds Projects
 * whose name matches. `debounceMs` holds the server search until typing pauses (the phone's keyboard sends a
 * change per letter); the desktop asks on every change, as it always has.
 */
export const useSearchModel = ({
	artifacts,
	projects,
	projectId = null,
	recentCount = 8,
	debounceMs = 0,
}: {
	artifacts: VisibleArtifact[]
	projects: Project[]
	/** Set on a Project page, which scopes the server search to that Project. */
	projectId?: string | null
	recentCount?: number
	debounceMs?: number
}) => {
	const [query, setQuery] = useState("")
	const trimmed = query.trim()
	const [settled, setSettled] = useState(trimmed)
	useEffect(() => {
		if (debounceMs <= 0) return
		const timer = setTimeout(() => setSettled(trimmed), debounceMs)
		return () => clearTimeout(timer)
	}, [trimmed, debounceMs])
	const asked = debounceMs <= 0 ? trimmed : settled
	const hits = useArtifactSearch({ q: asked, projectId })
	const views = useRecentViews()

	const projectNames = new Map(projects.map((project) => [project.id, project.name]))
	const fileRow = (artifact: VisibleArtifact): SearchResult => ({
		key: `file:${artifact.id}`,
		kind: "file",
		artifact,
		name: artifact.title,
		sub: artifact.projectId === null ? "No project" : (projectNames.get(artifact.projectId) ?? "No project"),
		activity: ageLabel(artifact.updatedAt),
		artifactId: artifact.id,
	})

	const projectRow = (project: Project): SearchResult => {
		const inside = artifacts.filter((artifact) => artifact.projectId === project.id)
		return {
			key: `project:${project.id}`,
			kind: "project",
			project,
			name: project.name,
			sub: `Project · ${inside.length === 1 ? "1 file" : `${inside.length} files`}`,
			activity: ageLabel(project.createdAt),
			to: paths.project(project.id),
		}
	}
	// On a Project page, only the Projects inside it are offered, as a typed search finds them.
	const inScope = (project: Project) => (projectId ? project.parentProjectId === projectId : true)

	let results: SearchResult[]
	if (trimmed === "") {
		const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
		const projectsById = new Map(projects.filter(inScope).map((project) => [project.id, project]))
		// A view of something since deleted, unshared or outside this scope is skipped.
		const viewed = views.flatMap((view): SearchResult[] => {
			if (view.kind === "file") {
				const artifact = byId.get(view.id)
				return artifact ? [fileRow(artifact)] : []
			}
			const project = projectsById.get(view.id)
			return project ? [projectRow(project)] : []
		})
		const seen = new Set(viewed.map((row) => row.key))
		const updated = [...artifacts]
			.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
			.map(fileRow)
			.filter((row) => !seen.has(row.key))
		results = [...viewed, ...updated].slice(0, recentCount)
	} else {
		const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
		const needle = trimmed.toLowerCase()
		const folders: SearchResult[] = projects
			.filter(inScope)
			.filter((project) => project.name.toLowerCase().includes(needle))
			.map(projectRow)
		// While a debounced ask catches up, the last answer is for an older query; it is not shown as this one's.
		const current = asked === trimmed ? (hits.data ?? []) : []
		const files: SearchResult[] = current.flatMap((hit) => {
			const artifact = byId.get(hit.artifactId)
			return artifact ? [fileRow(artifact)] : []
		})
		results = [...folders, ...files]
	}

	const searching = trimmed !== "" && (asked !== trimmed || hits.isPending)
	const error = trimmed !== "" && asked === trimmed && hits.isError ? hits.error.message || "Search failed" : null

	return {
		query,
		setQuery,
		trimmed,
		results,
		/** Nothing typed: `results` are what was viewed lately, then the most recently updated files. */
		recent: trimmed === "",
		/** The list's heading: "Recent", or the count once a search has answered (W:L766, C:L1728). */
		label: trimmed === "" ? "Recent" : searching ? "Searching…" : `${results.length} results`,
		searching,
		error,
		/** Typed, answered, and nothing matched. */
		empty: trimmed !== "" && !searching && error === null && results.length === 0,
	}
}
