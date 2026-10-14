import { type ArtifactKind } from "@exagram/api-client"

import { ICON, type IconKind } from "@/components/ui/fileType"
import { type TypeIconKind } from "@/components/ui/TypeIcon"
import { KIND_TAG } from "@/features/library/kinds"

export interface RecapFile {
	id: string
	name: string
	type: TypeIconKind
	rev: string
	updated: string
	projectId: string | null
	owner: string
	shared: string[]
}

export interface RecapProject {
	id: string
	name: string
}

export interface RecapRow {
	id: string
	name: string
	type: TypeIconKind
	rev: string
	meta: string
}

export interface RecapGroup {
	key: string
	label: string
	count: string
	open: boolean
	/** The caret's `transform: rotate(...)` value. */
	caret: string
	visibleItems: RecapRow[]
	allItems: RecapRow[]
	hasMore: boolean
	moreCount: number
}

export interface Recap {
	range: string
	summaryMeta: string
	nextRecap: string
	recapProgress: string
	sourceCount: number
	headline: string
	summary: string[]
	hasTakeaway: boolean
	takeaway: string
	sources: { id: string; name: string; tag: string }[]
	/** How many of the week's files the Sources column leaves out. */
	moreSources: number
	recapSub: string
	recapEmpty: boolean
	recapEmptyMsg: string
	groups: RecapGroup[]
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** The sample ages ("3d", "2w") are relative to 14 Sep 2026, the day the prototype calls today. */
export const SAMPLE_TODAY = new Date(2026, 8, 14)

const fmt = (date: Date) => `${date.getDate()} ${MON[date.getMonth()]}`

export const ageInDays = (updated: string) => {
	const n = parseInt(updated, 10)
	return updated.endsWith("w") ? n * 7 : n
}

/** The sidebar lists this many weeks, this week first; `?week=` is clamped to them. */
export const RECAP_WEEKS = 6

/**
 * Week `n` is the seven days `weekLabel` names: ages `7n` through `7n + 6`, so week 0 is today and the six days
 * before it.
 */
export const inWeek = (ageDays: number, week: number) => ageDays >= 7 * week && ageDays < 7 * week + 7

/** `?week=2` → 2. Anything missing, malformed or outside the listed weeks is this week. */
export const weekFromSearch = (search: URLSearchParams) => {
	const raw = search.get("week")
	const week = raw === null ? 0 : Number(raw)
	return Number.isInteger(week) && week >= 0 && week < RECAP_WEEKS ? week : 0
}

/**
 * The seven days ending `week` weeks before `today`, earliest first: "8–14 Sep" inside one month,
 * "31 Aug – 6 Sep" across two.
 */
export const weekLabel = (today: Date, week: number) => {
	const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7 * week)
	const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6)
	return start.getMonth() === end.getMonth()
		? `${start.getDate()}–${end.getDate()} ${MON[end.getMonth()]}`
		: `${fmt(start)} – ${fmt(end)}`
}

const filesLabel = (n: number) => (n === 1 ? "1 file" : `${n} files`)

/** The mono tag on a Sources row: the sample's own labels, or the library's kind tag for a real file. */
const tagOf = (type: TypeIconKind) =>
	type in ICON ? ICON[type as IconKind].label : type in KIND_TAG ? KIND_TAG[type as ArtifactKind] : type.toUpperCase()

/** "in 7h 12m": how long until the rolling week moves on at the next local midnight. */
const untilMidnight = (now: Date) => {
	const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
	const minutes = Math.max(0, Math.ceil((midnight.getTime() - now.getTime()) / 60_000))
	const hours = Math.floor(minutes / 60)
	return hours > 0 ? `in ${hours}h ${minutes % 60}m` : `in ${minutes}m`
}

/**
 * How far through today the clock is, as the next-recap bar's width: measured against this day's own
 * length (23 or 25 hours on a DST change), clamped to 0–100.
 */
const dayProgress = (now: Date) => {
	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
	const share = Math.round(((now.getTime() - start) / (end - start)) * 100)
	return `${Math.min(100, Math.max(0, share))}%`
}

/** Query words that should also match a type the name never spells out. */
const SYNONYMS: Record<string, TypeIconKind[]> = {
	doc: ["md", "doc"],
	docs: ["md", "doc"],
	document: ["md", "doc"],
	documents: ["md", "doc"],
	markdown: ["md", "doc"],
	pdf: ["pdf"],
	word: ["docx"],
	slides: ["pptx"],
	presentation: ["pptx"],
	spreadsheet: ["xlsx"],
	sheet: ["xlsx"],
	excel: ["xlsx"],
	image: ["image"],
	images: ["image"],
	picture: ["image"],
	photo: ["image"],
	page: ["html"],
	pages: ["html"],
	deck: ["html"],
	interactive: ["html"],
	conversation: ["chat"],
	convo: ["chat"],
	thread: ["chat"],
}

/** The Sources column lists this many; the rest are counted as "+N more". */
const SOURCES_SHOWN = 6

/** Groups past this many rows collapse to one open group and a "View N more" link per group. */
const VISIBLE_PER_GROUP = 5
const MANY_GROUPS_AT = 20

export const buildRecap = ({
	files,
	projects,
	week,
	query,
	groupBy,
	openGroups,
	rowFiles,
	today = SAMPLE_TODAY,
	now = new Date(),
	sample = false,
}: {
	/** Drives the summary band: the reader's own files, or the design's sample while the library is empty. */
	files: RecapFile[]
	projects: RecapProject[]
	week: number
	query: string
	groupBy: "project" | "day"
	openGroups: Record<string, boolean>
	/** The rows the list groups. Defaults to `files`, so the sample drives both sides. */
	rowFiles?: RecapFile[]
	today?: Date
	/** The real clock, for when the rolling week next moves on. */
	now?: Date
	/** The design's sample stands in: there is no real week to roll over. */
	sample?: boolean
}): Recap => {
	const dateAgo = (days: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - days)
	const projectsById = new Map(projects.map((p) => [p.id, p]))
	const projectName = (projectId: string | null) => (projectId ? projectsById.get(projectId)?.name : undefined)

	const byRecency = (list: RecapFile[]) =>
		list
			.filter((file) => inWeek(ageInDays(file.updated), week))
			.sort((a, b) => ageInDays(a.updated) - ageInDays(b.updated))
	const recent = byRecency(files)
	const listFiles = rowFiles ?? files
	const listRecent = rowFiles ? byRecency(rowFiles) : recent

	// Every file is a candidate for where attention went, including files in no Project and files in a
	// Project the reader cannot list; those get a phrase instead of a name.
	const NO_PROJECT = "_none"
	const ELSEWHERE = "_elsewhere"
	const groupOf = (file: RecapFile) =>
		file.projectId === null ? NO_PROJECT : projectsById.has(file.projectId) ? file.projectId : ELSEWHERE
	const nameOfGroup = (key: string) =>
		key === NO_PROJECT
			? "files in no folder"
			: key === ELSEWHERE
				? "files shared with you"
				: (projectsById.get(key)?.name ?? "files shared with you")
	const byProject = new Map<string, number>()
	for (const file of recent) byProject.set(groupOf(file), (byProject.get(groupOf(file)) ?? 0) + 1)
	const topProjects = [...byProject.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 4)
		.map(([key, n]) => ({ key, name: nameOfGroup(key), count: filesLabel(n) }))

	const owners = [...new Set(recent.map((file) => file.owner))]
	// `shared` holds the owner plus direct grants only, so this counts files shared directly with someone.
	const sharedOnward = recent.filter((file) => file.shared.length > 1).length
	const htmlRecent = recent.filter((file) => file.type === "html")
	const [lead, second] = topProjects
	const leadFile = lead ? recent.find((file) => groupOf(file) === lead.key) : undefined
	const weekWord = week === 0 ? "this week" : "that week"
	const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
	const searching = words.length > 0
	const score = (file: RecapFile) => {
		const hay = `${file.name} ${projectName(file.projectId) ?? "no folder"} ${file.owner} ${file.type}`.toLowerCase()
		let sc = 0
		for (const word of words) {
			if (file.name.toLowerCase().includes(word)) sc += 5
			if (hay.includes(word)) sc += 2
			if ((SYNONYMS[word] ?? []).includes(file.type)) sc += 4
		}
		if (sc > 0) sc += Math.max(0, 3 - ageInDays(file.updated) * 0.05)
		return sc
	}
	const source = searching
		? listFiles
				.map((file) => ({ file, sc: score(file) }))
				.filter((x) => x.sc > 0)
				.sort((a, b) => b.sc - a.sc)
				.map((x) => x.file)
		: listRecent
	const manyGroups = source.length > MANY_GROUPS_AT

	const dayLabel = (file: RecapFile) => {
		const age = ageInDays(file.updated)
		if (age <= 7) return age === 0 ? "today" : age === 1 ? "1 day ago" : `${age} days ago`
		const date = dateAgo(age)
		return `${DOW[date.getDay()]} ${fmt(date)}`
	}
	const rowify = (file: RecapFile): RecapRow => ({
		id: file.id,
		name: file.name,
		type: file.type,
		rev: file.rev,
		// Only direct grants are known here, so a file with none says nothing about who else can see it.
		meta: `${projectName(file.projectId) ?? (file.projectId === null ? "No folder" : "Shared with you")} · ${file.owner}${
			file.shared.length > 1 ? ` · shared with ${file.shared.length - 1}` : ""
		} · ${dayLabel(file)}`,
	})

	const buildGroup = (key: string, label: string, items: RecapFile[], index: number): RecapGroup => {
		const open = openGroups[key] ?? (manyGroups ? index === 0 : true)
		return {
			key,
			label,
			count: filesLabel(items.length),
			open,
			caret: open ? "rotate(90deg)" : "rotate(0deg)",
			visibleItems: items.slice(0, VISIBLE_PER_GROUP).map(rowify),
			allItems: items.map(rowify),
			hasMore: items.length > VISIBLE_PER_GROUP,
			moreCount: items.length - VISIBLE_PER_GROUP,
		}
	}

	const bucket = (keyOf: (file: RecapFile) => string) => {
		const map = new Map<string, RecapFile[]>()
		for (const file of source) {
			const key = keyOf(file)
			const items = map.get(key)
			if (items) items.push(file)
			else map.set(key, [file])
		}
		return map
	}

	let groups: RecapGroup[]
	if (searching) {
		groups = [buildGroup("search", "Search results", source, 0)]
	} else if (groupBy === "project") {
		const minAge = (items: RecapFile[]) => Math.min(...items.map((file) => ageInDays(file.updated)))
		groups = [...bucket((file) => file.projectId ?? "_").entries()]
			.sort((a, b) => minAge(a[1]) - minAge(b[1]))
			.map(([key, items], index) =>
				buildGroup(key, projectsById.get(key)?.name ?? (key === "_" ? "No folder" : "Shared with you"), items, index),
			)
	} else {
		groups = [...bucket((file) => file.updated).entries()]
			.sort((a, b) => ageInDays(a[0]) - ageInDays(b[0]))
			.map(([updated, items], index) => {
				const date = dateAgo(ageInDays(updated))
				return buildGroup(updated, `${DOW[date.getDay()]} ${fmt(date)}`, items, index)
			})
	}

	const fileCount = recent.length
	const pages = htmlRecent.length
	const moreSources = Math.max(0, recent.length - SOURCES_SHOWN)

	return {
		range: weekLabel(today, week),
		summaryMeta: `${sample ? "sample week · " : ""}from ${fileCount} ${fileCount === 1 ? "artifact" : "artifacts"}`,
		// The week is a rolling seven days ending today, so this week's recap moves on at midnight; a past
		// week does not change.
		nextRecap: sample ? "sample" : week === 0 ? untilMidnight(now) : "past week",
		recapProgress: sample ? "0%" : week === 0 ? dayProgress(now) : "100%",
		sourceCount: fileCount,
		headline:
			lead === undefined
				? `A quiet week — nothing in Artifacts was updated ${weekWord}.`
				: `Attention went to ${lead.name}${second ? ` and ${second.name}` : ""} ${weekWord} — ${fileCount} ${
						fileCount === 1 ? "file" : "files"
					} updated${pages > 0 ? `, ${pages} of them ${pages === 1 ? "an interactive page" : "interactive pages"}` : ""}.`,
		summary:
			lead === undefined
				? []
				: [
						`${capitalised(lead.name)} saw the most (${lead.count}).${
							leadFile ? ` The latest revision is “${leadFile.name}” at ${leadFile.rev}.` : ""
						}`,
						pages > 0
							? // An HTML page runs on an opaque origin with no network, so it cannot reach the rest of Exagram.
								`${pages === 1 ? "One interactive page" : `${pages} interactive pages`} (${htmlRecent
									.map((file) => file.name)
									.slice(0, 2)
									.join(
										"; ",
									)}) — ${pages === 1 ? "it runs" : "each runs"} in a sandbox with no network and no view of the rest of Exagram.`
							: `No interactive pages were updated ${weekWord}.`,
						`${owners.length === 1 ? "All of it belongs to one person" : `${owners.length} people own these files`}; ${sharedOnward} of ${fileCount} ${
							sharedOnward === 1 ? "is" : "are"
						} shared directly with someone.`,
					],
		hasTakeaway: lead !== undefined,
		takeaway: lead
			? `Most of ${weekWord}'s attention is concentrated in ${lead.name}${
					second ? ` and ${second.name}` : ""
				} — worth checking whether that's intentional or other folders are being neglected.`
			: "",
		sources: recent.slice(0, SOURCES_SHOWN).map((file) => ({ id: file.id, name: file.name, tag: tagOf(file.type) })),
		moreSources,
		recapSub: searching
			? `${source.length} match${source.length === 1 ? "" : "es"} across all time, ranked by relevance`
			: `${listRecent.length} ${listRecent.length === 1 ? "artifact" : "artifacts"}, grouped by ${groupBy === "day" ? "the day they were updated" : "folder"}`,
		recapEmpty: groups.length === 0,
		recapEmptyMsg: listRecent.length === 0 ? `Nothing was updated ${weekWord}.` : `No artifacts match “${query}”.`,
		groups,
	}
}
