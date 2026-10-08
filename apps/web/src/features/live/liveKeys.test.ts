import { describe, expect, it } from "vitest"

import { planFor } from "./liveKeys"

const A = "00000000-0000-4000-8000-00000000000a"

const keysOf = (topic: Parameters<typeof planFor>[0]["topic"], artifactId: string | null = A) => {
	const plan = planFor({ topic, artifactId })
	return {
		now: plan.now.map((entry) => entry.queryKey),
		debounced: plan.debounced.map((entry) => entry.queryKey),
		idle: [...plan.now, ...plan.debounced].filter((entry) => entry.idle).map((entry) => entry.queryKey),
	}
}

describe("planFor", () => {
	it("current: the Artifact, its Revisions and bodies now; the Library list debounced", () => {
		const { now, idle, debounced } = keysOf("current")
		expect(now).toEqual([
			["artifacts", "get", A],
			["revisions", "list", A],
			["revisions", "text", A],
			["revisions", "bodyToken", A],
			["revisions", "previewToken", A],
		])
		// A body on screen is never refetched under its old Revision id.
		expect(idle).toEqual([
			["revisions", "text", A],
			["revisions", "bodyToken", A],
			["revisions", "previewToken", A],
		])
		expect(debounced).toEqual([["artifacts", "list"]])
	})

	it("revisions: the Artifact and its Revision list now, the approvals inbox and the list debounced", () => {
		expect(keysOf("revisions")).toEqual({
			now: [
				["artifacts", "get", A],
				["revisions", "list", A],
			],
			debounced: [
				["approvals", "pending"],
				["artifacts", "list"],
			],
			idle: [],
		})
	})

	it("artifact: the Artifact and its redaction setting now, the list and search debounced", () => {
		expect(keysOf("artifact")).toEqual({
			now: [
				["artifacts", "get", A],
				["redaction", "artifact", A],
			],
			debounced: [
				["artifacts", "list"],
				["artifacts", "search"],
			],
			idle: [],
		})
	})

	it("removed: the Artifact now, the list and search debounced", () => {
		expect(keysOf("removed")).toEqual({
			now: [["artifacts", "get", A]],
			debounced: [
				["artifacts", "list"],
				["artifacts", "search"],
			],
			idle: [],
		})
	})

	it("reach: the Artifact and its Grants now; access, Project Grants, the list, search and Projects debounced", () => {
		expect(keysOf("reach")).toEqual({
			now: [
				["artifacts", "get", A],
				["grants", "list", A],
			],
			debounced: [
				["grants", "access"],
				["grants", "listForProject"],
				["artifacts", "list"],
				["artifacts", "search"],
				["projects", "list"],
			],
			idle: [],
		})
	})

	it("project: the Projects list, the Artifact list and every inherited redaction setting, all debounced", () => {
		expect(keysOf("project", null)).toEqual({
			now: [],
			debounced: [
				["projects", "list"],
				["artifacts", "list"],
				["redaction", "project"],
				["redaction", "artifact"],
				["redaction", "workspace"],
			],
			idle: [],
		})
		// Redacted text is one Revision's body: a Project change never refetches the one someone reads.
		expect(keysOf("project", null).debounced).not.toContainEqual(["redaction", "redactedText"])
		expect(keysOf("project", null).debounced).not.toContainEqual(["redaction"])
	})

	it("redaction: the Artifact's redaction now; redacted text and the approvals inbox debounced", () => {
		expect(keysOf("redaction")).toEqual({
			now: [["redaction", "artifact", A]],
			debounced: [
				["redaction", "redactedText"],
				["approvals", "pending"],
			],
			idle: [],
		})
	})

	it("comments: that Artifact's comments", () => {
		expect(keysOf("comments").now).toEqual([["comments", "list", A]])
	})

	it("accessRequests: the Owner's request list, debounced", () => {
		expect(keysOf("accessRequests")).toEqual({ now: [], debounced: [["accessRequests", "list"]], idle: [] })
	})

	it("ping: nothing", () => {
		expect(keysOf("ping", null)).toEqual({ now: [], debounced: [], idle: [] })
	})

	it("resync: every live key for every Artifact, all debounced", () => {
		const { now, debounced, idle } = keysOf("resync", null)
		expect(now).toEqual([])
		expect(debounced).toEqual([
			["artifacts", "get"],
			["revisions", "list"],
			["revisions", "text"],
			["revisions", "bodyToken"],
			["revisions", "previewToken"],
			["approvals", "pending"],
			["grants", "access"],
			["grants", "list"],
			["grants", "listForProject"],
			["redaction", "artifact"],
			["redaction", "redactedText"],
			["comments", "list"],
			["accessRequests", "list"],
			["artifacts", "list"],
			["artifacts", "search"],
			["projects", "list"],
		])
		expect(idle).toEqual([
			["revisions", "text"],
			["revisions", "bodyToken"],
			["revisions", "previewToken"],
		])
	})

	it("an event naming no Artifact widens to every Artifact's key, debounced", () => {
		expect(keysOf("comments", null)).toEqual({ now: [], debounced: [["comments", "list"]], idle: [] })
	})
})
