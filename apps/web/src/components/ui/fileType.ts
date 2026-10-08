export type FileType = "md" | "html" | "chat"
export type IconKind = FileType | "folder"

export type IconTone = { bg: string; fg: string; label: string }

export const ICON: Record<IconKind, IconTone> = {
	md: { bg: "var(--color-subtle)", fg: "var(--color-ink)", label: "MD" },
	html: { bg: "var(--color-html-bg)", fg: "var(--color-html-fg)", label: "HTML" },
	chat: { bg: "var(--color-ink)", fg: "var(--color-dark-text-2)", label: "CHAT" },
	folder: { bg: "var(--color-ink)", fg: "#fff", label: "" },
}
