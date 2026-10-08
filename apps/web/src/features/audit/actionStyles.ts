export type AuditAction = "read" | "search" | "summarize" | "write" | "list"

export const ACTION: Record<AuditAction, { bg: string; fg: string }> = {
	read: { bg: "var(--color-green-bg)", fg: "var(--color-green-fg)" },
	search: { bg: "var(--color-blue-bg)", fg: "var(--color-blue-fg)" },
	summarize: { bg: "var(--color-chip)", fg: "var(--color-secondary-2)" },
	write: { bg: "var(--color-orange-bg)", fg: "var(--color-orange-fg)" },
	list: { bg: "var(--color-line-pale)", fg: "var(--color-secondary)" },
}
