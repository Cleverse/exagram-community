import { describe, expect, it } from "vitest"

import { buildRecap, inWeek, type RecapFile, type RecapProject, weekFromSearch, weekLabel } from "./recap"

import { makeFiles, makeProjects } from "@/test/fixtures/sample"

const files: RecapFile[] = makeFiles()
const projects: RecapProject[] = makeProjects()

const recapFor = (patch: Partial<Parameters<typeof buildRecap>[0]> = {}) =>
	buildRecap({ files, projects, week: 0, query: "", groupBy: "project", openGroups: {}, ...patch })

describe("buildRecap", () => {
	it("labels the current week's range earliest day first", () => {
		expect(recapFor().range).toBe("8–14 Sep")
	})

	it("walks the range back one week at a time", () => {
		expect(recapFor({ week: 1 }).range).toBe("1–7 Sep")
		expect(recapFor({ week: 2 }).range).toBe("25–31 Aug")
	})

	it("counts only the artifacts inside the selected week", () => {
		expect(recapFor().sourceCount).toBe(7)
		expect(recapFor({ week: 1 }).sourceCount).toBe(7)
		expect(recapFor({ week: 2 }).sourceCount).toBe(13)
	})

	it("summarises the busiest projects from the week's artifacts", () => {
		const recap = recapFor()
		expect(recap.summaryMeta).toBe("from 7 artifacts")
		expect(recap.headline).toBe(
			"Attention went to Exagram Landing and Exagram Pricing this week — 7 files updated, 3 of them interactive pages.",
		)
		expect(recap.summary[0]).toBe(
			"Exagram Landing saw the most (2 files). The latest revision is “Exagram Landing + Pricing v3.0 — draft” at v1.",
		)
		expect(recap.hasTakeaway).toBe(true)
		expect(recap.takeaway).toContain("concentrated in Exagram Landing and Exagram Pricing")
	})

	it("counts down to midnight for this week, and calls an older week past", () => {
		const now = new Date(2026, 8, 14, 17, 0)
		// The week is a rolling seven days, so this week's recap moves on at midnight.
		expect(recapFor({ now }).nextRecap).toBe("in 7h 0m")
		expect(recapFor({ now }).recapProgress).toBe("71%")
		expect(recapFor({ now: new Date(2026, 8, 14, 23, 45) }).nextRecap).toBe("in 15m")
		expect(recapFor({ week: 1, now }).nextRecap).toBe("past week")
		expect(recapFor({ week: 1, now }).recapProgress).toBe("100%")
	})

	it("claims nothing the template cannot know", () => {
		const text = [recapFor().headline, ...recapFor().summary].join(" ")
		expect(text).not.toMatch(/MCP|made public|no such thing|arrived|landed|documents|private/)
		expect(recapFor().summary[2]).toBe("2 people own these files; 1 of 7 is shared directly with someone.")
		// ADR 0015: an HTML page runs on an opaque origin with no network.
		expect(recapFor().summary[1]).toMatch(/in a sandbox with no network and no view of the rest of Exagram\.$/)
	})

	it("falls back to the quiet-week copy, worded for the week it is about", () => {
		const recap = recapFor({ week: 4 })
		expect(recap.headline).toBe("A quiet week — nothing in Artifacts was updated that week.")
		expect(recap.summary).toEqual([])
		expect(recap.hasTakeaway).toBe(false)
		expect(recap.recapEmpty).toBe(true)
		expect(recap.recapEmptyMsg).toBe("Nothing was updated that week.")
		expect(recapFor({ rowFiles: [], week: 0 }).recapEmptyMsg).toBe("Nothing was updated this week.")
	})

	it("groups by project, oldest-arriving project last", () => {
		const recap = recapFor()
		expect(recap.recapSub).toBe("7 artifacts, grouped by project")
		expect(recap.groups.map((group) => group.label)).toEqual([
			"Projects",
			"Exagram Landing",
			"Exagram Pricing",
			"Atlas",
			"ATLAS",
		])
		expect(recap.groups[0]?.count).toBe("1 file")
	})

	it("groups by the day artifacts were updated", () => {
		const recap = recapFor({ groupBy: "day" })
		expect(recap.recapSub).toBe("7 artifacts, grouped by the day they were updated")
		expect(recap.groups.map((group) => group.key)).toEqual(["3d", "6d"])
	})

	it("opens every group and rotates its caret while there are few of them", () => {
		const recap = recapFor()
		expect(recap.groups.every((group) => group.open)).toBe(true)
		expect(recap.groups[0]?.caret).toBe("rotate(90deg)")
	})

	it("honours an explicitly collapsed group", () => {
		const recap = recapFor({ openGroups: { proj: false } })
		expect(recap.groups[0]?.open).toBe(false)
		expect(recap.groups[0]?.caret).toBe("rotate(0deg)")
	})

	it("caps a group at five rows and counts the rest for the modal", () => {
		const recap = recapFor({ week: 1, groupBy: "day" })
		const group = recap.groups[0]
		expect(group?.visibleItems).toHaveLength(5)
		expect(group?.hasMore).toBe(true)
		expect(group?.moreCount).toBe(group!.allItems.length - 5)
	})

	it("writes the project, owner, sharing and age into each row's meta line", () => {
		const row = recapFor({ groupBy: "day" }).groups[0]?.visibleItems[0]
		expect(row?.name).toBe("Product Throughput — Unblocking the PM Bottleneck")
		expect(row?.rev).toBe("v3")
		// Only direct grants are known, so a file with none says nothing about who else sees it.
		expect(row?.meta).toBe("Projects · ada · 3 days ago")
	})

	it("marks an artifact shared onward with the number of other people", () => {
		const rows = recapFor({ week: 1, groupBy: "day" }).groups.flatMap((group) => group.allItems)
		expect(rows.find((row) => row.name === "All-hands 202609 — Deck")?.meta).toBe(
			"No project · grace · shared with 1 · 7 days ago",
		)
	})

	it("searches every week and flattens the result into one ranked group", () => {
		const recap = recapFor({ query: "lantern" })
		expect(recap.groups).toHaveLength(1)
		expect(recap.groups[0]?.label).toBe("Search results")
		expect(recap.recapSub).toBe("3 matches across all time, ranked by relevance")
		expect(recap.groups[0]?.allItems.every((row) => row.name.toLowerCase().includes("lantern"))).toBe(true)
	})

	it("ranks a name match above a match on the project or owner alone", () => {
		const names = recapFor({ query: "pricing" }).groups[0]?.allItems.map((row) => row.name) ?? []
		expect(names[0]).toContain("Pricing")
		expect(names).toContain("Pricing page mock")
	})

	it("maps a synonym onto the artifact type it describes", () => {
		const rows = recapFor({ query: "conversation" }).groups[0]?.allItems ?? []
		expect(rows.length).toBeGreaterThan(0)
		expect(rows.some((row) => row.type === "chat")).toBe(true)
	})

	it("reports a single match in the singular", () => {
		expect(recapFor({ query: "comparison" }).recapSub).toBe("1 match across all time, ranked by relevance")
	})

	it("groups `rowFiles` apart from the files the summary reads", () => {
		const rowFiles: RecapFile[] = [
			{
				id: "a1",
				name: "Lantern migration plan",
				type: "doc",
				rev: "v2",
				updated: "2d",
				projectId: "rp",
				owner: "nina",
				shared: ["nina"],
			},
			{
				id: "a2",
				name: "Older note",
				type: "doc",
				rev: "v1",
				updated: "40d",
				projectId: "rp",
				owner: "nina",
				shared: ["nina"],
			},
		]
		const recap = recapFor({ rowFiles, projects: [...projects, { id: "rp", name: "Lantern Rollout" }] })

		expect(recap.groups.map((group) => [group.label, group.count])).toEqual([["Lantern Rollout", "1 file"]])
		expect(recap.groups[0]?.allItems[0]?.meta).toBe("Lantern Rollout · nina · 2 days ago")
		expect(recap.recapSub).toBe("1 artifact, grouped by project")
		expect(recap.summaryMeta).toBe("from 7 artifacts")
		expect(recap.sourceCount).toBe(7)
	})

	it("dates the day groups from the day it is given", () => {
		const rowFiles: RecapFile[] = [
			{
				id: "a1",
				name: "Today's upload",
				type: "html",
				rev: "v1",
				updated: "0d",
				projectId: null,
				owner: "nina",
				shared: ["nina"],
			},
		]
		const recap = recapFor({ rowFiles, groupBy: "day", today: new Date(2026, 8, 17) })
		expect(recap.groups.map((group) => group.label)).toEqual(["Thu 17 Sep"])
		expect(recap.range).toBe("11–17 Sep")
	})

	it("says nothing was updated when the rows are empty but the summary's files are not", () => {
		const recap = recapFor({ rowFiles: [] })
		expect(recap.recapEmpty).toBe(true)
		expect(recap.recapEmptyMsg).toBe("Nothing was updated this week.")
		expect(recap.headline).toMatch(/^Attention went to/)
	})
})

describe("weeks", () => {
	it("labels a week inside one month with a single month name, and one across two with both", () => {
		const today = new Date(2026, 8, 27)
		expect(weekLabel(today, 0)).toBe("21–27 Sep")
		expect(weekLabel(today, 1)).toBe("14–20 Sep")
		expect(weekLabel(today, 3)).toBe("31 Aug – 6 Sep")
	})

	it("puts ages into the week they fall in, the same seven days its label names", () => {
		expect(inWeek(0, 0)).toBe(true)
		expect(inWeek(6, 0)).toBe(true)
		expect(inWeek(7, 0)).toBe(false)
		expect(inWeek(7, 1)).toBe(true)
		expect(inWeek(13, 1)).toBe(true)
		expect(inWeek(14, 1)).toBe(false)
	})

	it("counts in a week exactly the days its label spans", () => {
		const today = new Date(2026, 8, 14)
		// 8–14 Sep is ages 0–6; 7 Sep (age 7) opens 1–7 Sep.
		expect(weekLabel(today, 0)).toBe("8–14 Sep")
		const labelled = Array.from({ length: 21 }, (_, age) => age).filter((age) => inWeek(age, 0))
		expect(labelled).toEqual([0, 1, 2, 3, 4, 5, 6])
		expect(weekLabel(today, 1)).toBe("1–7 Sep")
		expect(Array.from({ length: 21 }, (_, age) => age).filter((age) => inWeek(age, 1))).toEqual([
			7, 8, 9, 10, 11, 12, 13,
		])
	})

	it("reads the week from the query string, falling back to this week", () => {
		expect(weekFromSearch(new URLSearchParams("week=3"))).toBe(3)
		expect(weekFromSearch(new URLSearchParams(""))).toBe(0)
		expect(weekFromSearch(new URLSearchParams("week=9"))).toBe(0)
		expect(weekFromSearch(new URLSearchParams("week=-1"))).toBe(0)
		expect(weekFromSearch(new URLSearchParams("week=1.5"))).toBe(0)
		expect(weekFromSearch(new URLSearchParams("week=abc"))).toBe(0)
	})
})

describe("buildRecap with real files", () => {
	const file = (over: Partial<RecapFile>): RecapFile => ({
		id: "f1",
		name: "Note",
		type: "doc",
		rev: "v1",
		updated: "1d",
		projectId: null,
		owner: "nina",
		shared: ["nina"],
		...over,
	})
	const real = (files: RecapFile[], extra: Partial<Parameters<typeof buildRecap>[0]> = {}) =>
		buildRecap({
			files,
			projects: [],
			week: 0,
			query: "",
			groupBy: "project",
			openGroups: {},
			rowFiles: files,
			...extra,
		})

	it("puts files in no project in the headline instead of calling the week quiet", () => {
		const recap = real([file({ id: "f1" }), file({ id: "f2", type: "pdf" })])
		expect(recap.headline).toBe("Attention went to files in no project this week — 2 files updated.")
		expect(recap.summary[0]).toBe("Files in no project saw the most (2 files). The latest revision is “Note” at v1.")
		expect(recap.summary[1]).toBe("No interactive pages were updated this week.")
		expect(recap.groups.map((group) => group.label)).toEqual(["No project"])
	})

	it("names files in a project the reader cannot list as shared with them", () => {
		const recap = real([file({ projectId: "hidden" })])
		expect(recap.headline).toMatch(/^Attention went to files shared with you this week/)
		expect(recap.groups.map((group) => group.label)).toEqual(["Shared with you"])
		expect(recap.groups[0]?.allItems[0]?.meta).toMatch(/^Shared with you · /)
	})

	it("reads a zero-file week in a non-empty library as quiet, in that week's words", () => {
		const recap = real([file({ updated: "20d" })], { week: 1 })
		expect(recap.headline).toBe("A quiet week — nothing in Artifacts was updated that week.")
		expect(recap.recapEmptyMsg).toBe("Nothing was updated that week.")
		expect(recap.sources).toEqual([])
	})

	it("lists six sources and counts the rest", () => {
		const recap = real(Array.from({ length: 8 }, (_, index) => file({ id: `f${index}`, name: `N${index}` })))
		expect(recap.sources).toHaveLength(6)
		expect(recap.moreSources).toBe(2)
	})

	it("finds office files and images by the words people use for them", () => {
		const files = [
			file({ id: "s", name: "Q3", type: "pptx" }),
			file({ id: "x", name: "Budget", type: "xlsx" }),
			file({ id: "i", name: "Logo", type: "image" }),
			file({ id: "d", name: "Brief", type: "doc" }),
		]
		const found = (query: string) => real(files, { query }).groups[0]?.allItems.map((row) => row.id) ?? []
		expect(found("slides")).toEqual(["s"])
		expect(found("spreadsheet")).toEqual(["x"])
		expect(found("image")).toEqual(["i"])
		expect(found("docs")).toEqual(["d"])
	})

	it("measures today's progress against the day's own length on a DST change", () => {
		// Whatever the zone, progress stays within 0–100.
		const late = real([file({})], { now: new Date(2026, 2, 8, 23, 59) })
		expect(parseInt(late.recapProgress, 10)).toBeGreaterThanOrEqual(99)
		expect(parseInt(late.recapProgress, 10)).toBeLessThanOrEqual(100)
	})
})
