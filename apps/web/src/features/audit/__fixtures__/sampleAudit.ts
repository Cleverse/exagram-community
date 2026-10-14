import { type AuditRow, type ClientChip, iconOf } from "../auditModel"

import { AUDIT, CLIENTS, makeFiles, makeProjects, ME, PEOPLE } from "@/test/fixtures/sample"
import { initialsOf } from "@/utils/initials"

const FILES = makeFiles()
const PROJECTS = makeProjects()

// Every client in the prototype is one of mine, so every sample call is made on my behalf.
const ME_PERSON = Object.values(PEOPLE).find((person) => person.user === ME)

export const SAMPLE_CHIPS: ClientChip[] = [
	{ id: "all", label: "All origins" },
	...CLIENTS.map((client) => ({ id: client.id, label: client.name })),
]

/**
 * Test fixture data only: rows shaped like the table's real `AuditRow`s, for `AuditPage.test.tsx`
 * and `auditModel.test.ts`. The screen itself never falls back to these — an empty or refused
 * Ledger read shows an honest empty/forbidden state instead (`useAuditRows`).
 */
export const SAMPLE_ROWS: AuditRow[] = AUDIT.map((entry, index) => {
	const client = CLIENTS.find((candidate) => candidate.id === entry.clientId)
	const file = entry.fileId === null ? undefined : FILES.find((candidate) => candidate.id === entry.fileId)
	const project = file?.projectId === undefined ? undefined : PROJECTS.find((p) => p.id === file?.projectId)
	const icon = iconOf(file?.type ?? null, entry.action)

	return {
		id: `sample-${index}`,
		clientId: entry.clientId,
		client: client?.name ?? entry.clientId,
		clientInitials: client?.initials ?? "?",
		clientBg: client?.iconBg ?? "var(--color-ink)",
		clientFg: client?.iconFg ?? "var(--color-dark-text-2)",
		user: ME_PERSON?.name ?? ME,
		userEmail: ME_PERSON?.email ?? null,
		userInitials: initialsOf(ME_PERSON?.name, ME_PERSON?.email),
		time: entry.time,
		action: entry.action,
		doc: file?.name ?? (entry.action === "search" ? "Search across artifacts" : "Folder listing"),
		iconBg: icon.bg,
		iconFg: icon.fg,
		iconLabel: icon.label,
		rev: entry.rev,
		revNote: file === undefined ? "n/a" : entry.rev === file.rev ? "current" : "superseded since",
		tokensIn: entry.tokensIn,
		tokensOut: entry.tokensOut,
		redactedSpans: entry.redactedSpans,
		query: entry.query,
		scopeNote: `Scope ${entry.action === "write" ? "artifacts:write" : "artifacts:read"} · policy ${
			project?.policy !== undefined && project.policy !== "" ? "applied" : "not set"
		} · redaction ${client?.redaction ?? "default"}`,
	}
})
