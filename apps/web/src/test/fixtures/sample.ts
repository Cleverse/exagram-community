import { type FileType } from "@/components/ui/fileType"
import { type AuditAction } from "@/features/audit/actionStyles"

/** Neutral sample rows for tests. Nothing here ships to a screen. */

export type Person = {
	name: string
	email: string
	user: string
}

export const ME = "ada"

export const PEOPLE: Record<string, Person> = {
	AL: { name: "Ada Lovelace", email: "ada@example.com", user: "ada" },
	GH: { name: "Grace Hopper", email: "grace@example.com", user: "grace" },
	AT: { name: "Alan Turing", email: "alan@example.com", user: "alan" },
}

export type PublishRule = "auto" | "owner" | "editors"

export type MockClient = {
	id: string
	name: string
	initials: string
	iconBg?: string
	iconFg?: string
	kind: string
	connected: string
	lastUsed: string
	scopes: string[]
	redaction: "default" | "strict" | "patterns"
}

export const CLIENTS: MockClient[] = [
	{
		id: "desktop",
		name: "Claude Desktop",
		initials: "CD",
		kind: "OAuth connector",
		connected: "12 Aug 2026",
		lastUsed: "2h",
		scopes: ["meetings:read", "artifacts:read", "artifacts:write", "tasks:read"],
		redaction: "default",
	},
	{
		id: "code",
		name: "Claude Code",
		initials: "CC",
		iconBg: "var(--color-ink)",
		iconFg: "#fff",
		kind: "Personal access token · sandboxed",
		connected: "02 Sep 2026",
		lastUsed: "3d",
		scopes: ["artifacts:read", "artifacts:write", "artifacts:manage_grants"],
		redaction: "strict",
	},
	{
		id: "chatgpt",
		name: "ChatGPT",
		initials: "GPT",
		iconBg: "var(--color-chip)",
		iconFg: "var(--color-ink)",
		kind: "OAuth connector",
		connected: "19 Jun 2026",
		lastUsed: "2w",
		scopes: ["meetings:read"],
		redaction: "default",
	},
]

export type AuditRow = {
	time: string
	age: number
	clientId: string
	action: AuditAction
	fileId: string | null
	rev: string
	query: string
	redactedSpans: number
	tokensIn: number
	tokensOut: number
}

const auditRow = (
	time: string,
	age: number,
	clientId: string,
	action: AuditAction,
	fileId: string | null,
	rev: string,
	query: string,
	redactedSpans: number,
	tokensIn: number,
	tokensOut: number,
): AuditRow => ({ time, age, clientId, action, fileId, rev, query, redactedSpans, tokensIn, tokensOut })

export const AUDIT: AuditRow[] = [
	auditRow(
		"Today 14:22",
		0,
		"code",
		"read",
		"f6",
		"v2",
		"Read the workshop brief to list the tracks and their deliverables.",
		2,
		6120,
		0,
	),
	auditRow(
		"Today 14:21",
		0,
		"code",
		"search",
		null,
		"—",
		'search: "workshop review criteria" across Projects',
		0,
		940,
		180,
	),
	auditRow(
		"Today 11:05",
		0,
		"desktop",
		"summarize",
		"f1",
		"v3",
		"Summarize the all-hands deck in five bullets for a Slack post.",
		4,
		9840,
		620,
	),
	auditRow("Today 09:48", 0, "desktop", "read", "f3", "v7", "Open the 1-on-1 agenda before the meeting.", 6, 3210, 0),
	auditRow(
		"Yesterday 17:30",
		1,
		"code",
		"write",
		"f7",
		"v2",
		"Upload revised review checklist as a new revision (pending approval).",
		0,
		0,
		0,
	),
	auditRow(
		"Yesterday 16:02",
		1,
		"code",
		"read",
		"f7",
		"v1",
		"Read the review checklist before editing it.",
		0,
		2890,
		0,
	),
	auditRow("Yesterday 10:14", 1, "chatgpt", "list", null, "—", "List artifacts in Exagram Landing.", 0, 310, 0),
	auditRow(
		"Yesterday 10:15",
		1,
		"chatgpt",
		"read",
		"f8",
		"v1",
		"Read the landing page draft to check pricing tiers.",
		1,
		7420,
		0,
	),
	auditRow(
		"Fri 15:40",
		3,
		"desktop",
		"summarize",
		"f4",
		"v1",
		"Turn the management principles into an onboarding checklist.",
		0,
		4130,
		540,
	),
	auditRow(
		"Fri 09:02",
		3,
		"desktop",
		"search",
		null,
		"—",
		'search: "quarterly target" across all artifacts',
		3,
		1220,
		160,
	),
	auditRow(
		"Thu 18:11",
		4,
		"code",
		"read",
		"f6",
		"v1",
		"Read the workshop brief (previous revision) for the timeline table.",
		2,
		5980,
		0,
	),
	auditRow("Wed 13:27", 5, "chatgpt", "read", "f1", "v3", "Open the all-hands deck.", 4, 9840, 0),
]

export type MockProject = {
	id: string
	name: string
	owner: string
	shared: string[]
	isShared?: boolean
	updated: string
	/** `[name, fileCount, updated]` — the prototype's one level of subfolders. */
	sub?: [name: string, files: number, updated: string][]
	policy?: string
	overwrite?: boolean
	publish?: PublishRule
}

export type MockFile = {
	id: string
	name: string
	type: FileType
	rev: string
	updated: string
	projectId: string | null
	owner: string
	shared: string[]
	tags: string[]
	size: string
	pinned?: boolean
	kind?: "deck" | "landing"
	fileName?: string
	pending?: { rev: string; by: string; when: string }
}

export const makeProjects = (): MockProject[] => [
	{
		id: "proj",
		name: "Projects",
		owner: "ada",
		shared: ["AL", "GH", "AT"],
		isShared: true,
		updated: "3d",
		sub: [
			["Design", 1, "2w"],
			["Ops", 1, "2w"],
			["Sales", 1, "2w"],
			["Support", 4, "5d"],
		],
		policy:
			"Answer only from files in this project and cite the file name and revision for every claim. Never merge content from other projects. Do not surface unreleased pricing or customer details to a client unless the requester holds Can edit.",
		overwrite: true,
		publish: "owner",
	},
	{
		id: "exl",
		name: "Exagram Landing",
		owner: "ada",
		shared: ["AL"],
		updated: "5d",
		policy: "",
		overwrite: false,
		publish: "auto",
	},
	{ id: "exp", name: "Exagram Pricing", owner: "ada", shared: ["AL"], updated: "6d" },
	{ id: "atlas", name: "Atlas", owner: "ada", shared: ["AL"], updated: "6d" },
	{ id: "ATLAS", name: "ATLAS", owner: "grace", shared: ["GH", "AL"], updated: "6d", isShared: true },
	{ id: "orbit", name: "Orbit Design Kit", owner: "ada", shared: ["AL", "GH"], updated: "1w", isShared: true },
	{ id: "ri", name: "Research & Intelligence", owner: "ada", shared: ["AL"], updated: "2w" },
	{ id: "plan", name: "Planning", owner: "ada", shared: ["AL"], updated: "2w" },
	{ id: "spd", name: "Exagram Product Docs", owner: "ada", shared: ["AL"], updated: "2w" },
	{ id: "lantern", name: "Lantern Agent Idea", owner: "ada", shared: ["AL"], updated: "2w" },
	{ id: "oo", name: "1-on-1 Management System", owner: "ada", shared: ["AL"], updated: "2w" },
	{ id: "fops", name: "Field Operations", owner: "ada", shared: ["AL", "GH"], updated: "3w", isShared: true },
	{ id: "cts", name: "Team Tech Stack", owner: "ada", shared: ["AL"], updated: "3w" },
	{
		id: "vnd",
		name: "Vendor Reviews",
		owner: "ada",
		shared: ["AL", "AT"],
		updated: "3w",
		isShared: true,
	},
]

export const makeFiles = (demoHighVolume = false): MockFile[] => {
	let id = 0
	const F = (
		name: string,
		type: FileType,
		rev: string,
		updated: string,
		projectId: string | null,
		extra: Partial<MockFile> = {},
	): MockFile => ({
		id: `f${++id}`,
		name,
		type,
		rev,
		updated,
		projectId,
		owner: "ada",
		shared: ["AL"],
		tags: [],
		size: "24 KB",
		...extra,
	})

	const files: MockFile[] = [
		F("All-hands 202609 — Deck", "html", "v3", "1w", null, {
			owner: "grace",
			shared: ["GH", "AL"],
			pinned: true,
			kind: "deck",
			fileName: "All-hands-202609-deck.html",
			size: "412 KB",
		}),
		F("Product Throughput — Unblocking the PM Bottleneck", "md", "v3", "3d", "proj"),
		F("1-on-1 Agenda & Prep Guide", "md", "v7", "1w", "proj"),
		F("Core Management & Engineering Principles", "md", "v1", "2w", "proj"),
		F("Personal Project & Self-Growth Guideline: Building in the AI Era", "md", "v1", "2w", "proj"),
		F("Internal AI-Assisted Product Workshop: Project Brief & Track Catalog", "md", "v2", "2w", "proj", {
			fileName: "Internal AI Product Workshop - Project Brief.md",
		}),
		F("Internal AI-Assisted Product Workshop: Review Checklist & Guide", "md", "v1", "2w", "proj"),
		F("Exagram Landing + Pricing v3.0 — draft", "html", "v1", "6d", "exl", {
			kind: "landing",
			fileName: "Exagram-Landing-v3.0.html",
			size: "64 KB",
			tags: ["Exagram", "Landing"],
		}),
		F("Exagram Landing Page v2.0 — release", "html", "v2", "6d", "exl", {
			kind: "landing",
			fileName: "Exagram-Landing-v2.0.html",
			size: "51 KB",
			tags: ["Exagram", "Landing", "v2", "Marketing"],
		}),
		F("Exagram Pricing — tiers", "md", "v4", "6d", "exp"),
		F("Exagram Pricing — FAQ", "md", "v2", "1w", "exp"),
		F("Pricing page mock", "html", "v1", "6d", "exp", { kind: "landing" }),
		F("Atlas — conversation 2026-09-08", "chat", "v1", "6d", "atlas"),
		F("Atlas — onboarding guide", "md", "v5", "1w", "atlas"),
		F("ATLAS — pitch notes", "md", "v2", "6d", "ATLAS", { owner: "grace", shared: ["GH", "AL"] }),
		F("ATLAS — data model", "md", "v1", "1w", "ATLAS", { owner: "grace", shared: ["GH", "AL"] }),
		F("Orbit Design Kit — components", "md", "v3", "1w", "orbit", { shared: ["AL", "GH"] }),
		F("Orbit Design Kit — demo", "html", "v2", "1w", "orbit", { kind: "landing", shared: ["AL", "GH"] }),
		F("Research digest — August", "md", "v1", "2w", "ri"),
		F("Competitor map", "md", "v2", "2w", "ri"),
		F("Q3 roadmap", "md", "v1", "2w", "plan"),
		F("Exagram Artifacts — product spec", "md", "v6", "2w", "spd"),
		F("Lantern Agent — idea", "md", "v1", "2w", "lantern"),
		F("Lantern — conversation", "chat", "v1", "2w", "lantern"),
		F("Lantern — architecture", "md", "v2", "2w", "lantern"),
		F("1-on-1 — system overview", "md", "v2", "2w", "oo"),
		F("1-on-1 — template", "md", "v1", "2w", "oo"),
		F("Field Operations — brief", "md", "v1", "3w", "fops", { shared: ["AL", "GH"] }),
		F("Team Tech Stack", "md", "v1", "3w", "cts"),
		F("Vendor shortlist", "md", "v3", "3w", "vnd", { shared: ["AL", "AT"] }),
		F("Review process", "md", "v1", "3w", "vnd", { shared: ["AL", "AT"] }),
		F("Vendor comparison", "md", "v1", "3w", "vnd", { shared: ["AL", "AT"] }),
		F("Vendors — conversation", "chat", "v1", "3w", "vnd", { shared: ["AL", "AT"] }),
	]

	if (demoHighVolume) {
		const projectIds = makeProjects().map((project) => project.id)
		const names = [
			"Sync note",
			"Meeting recap",
			"Draft outline",
			"Data pull",
			"Status update",
			"Follow-up notes",
			"Research snippet",
			"Task brief",
		]
		const types: FileType[] = ["md", "html", "chat"]
		for (let i = 1; i <= 90; i++) {
			const name = `${names[i % names.length] ?? "Sync note"} #${i}`
			files.push(
				F(name, types[i % 3] ?? "md", "v1", `${i % 7}d`, projectIds[i % projectIds.length] ?? null, { size: "8 KB" }),
			)
		}
	}

	const pend = (fileId: string, rev: string, by: string, when: string) => {
		const file = files.find((candidate) => candidate.id === fileId)
		if (file) file.pending = { rev, by, when }
	}
	pend("f3", "v8", "GH", "2h ago")
	pend("f7", "v2", "AT", "yesterday")

	return files
}
