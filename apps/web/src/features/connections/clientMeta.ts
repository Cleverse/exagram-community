import { type Connection } from "@exagram/api-client"

export type ClientLook = {
	initials: string
	iconBg: string
	/** The 44px row icon and the 72px dialog icon take different ink in the prototype. */
	rowFg: string
	detailFg: string
}

/** The prototype's `CLIENTS` palette, keyed by the name a Connection is given at consent. */
const KNOWN_LOOKS: Record<string, ClientLook> = {
	"claude desktop": {
		initials: "CD",
		iconBg: "var(--color-ink)",
		rowFg: "var(--color-dark-text)",
		detailFg: "var(--color-dark-text-2)",
	},
	"claude code": { initials: "CC", iconBg: "var(--color-ink)", rowFg: "#fff", detailFg: "#fff" },
	claude: {
		initials: "C",
		iconBg: "var(--color-gold-card)",
		rowFg: "var(--color-gold-fg)",
		detailFg: "var(--color-gold-fg)",
	},
	chatgpt: { initials: "GPT", iconBg: "var(--color-chip)", rowFg: "var(--color-ink)", detailFg: "var(--color-ink)" },
	cursor: { initials: "CU", iconBg: "var(--color-chip)", rowFg: "var(--color-ink)", detailFg: "var(--color-ink)" },
	"vs code": {
		initials: "VS",
		iconBg: "var(--color-blue-bg)",
		rowFg: "var(--color-blue-fg)",
		detailFg: "var(--color-blue-fg)",
	},
	"gemini cli": {
		initials: "GM",
		iconBg: "var(--color-chip)",
		rowFg: "var(--color-ink)",
		detailFg: "var(--color-ink)",
	},
}

const derivedInitials = (name: string) =>
	name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((word) => word[0]?.toUpperCase() ?? "")
		.join("") || "?"

export const clientLook = (name: string): ClientLook =>
	KNOWN_LOOKS[name.trim().toLowerCase()] ?? {
		initials: derivedInitials(name),
		iconBg: "var(--color-ink)",
		rowFg: "var(--color-dark-text)",
		detailFg: "var(--color-dark-text-2)",
	}

const CONNECTED_DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" })

/** "12 Aug 2026", the form the prototype prints for `client.connected`. */
export const formatConnectedDate = (value: Date | string): string =>
	CONNECTED_DATE.format(value instanceof Date ? value : new Date(value))

export const CONNECTION_KIND = "OAuth connector"

/** `scopes` is empty only for a Connection that predates Artifact scopes; the design calls it stale. */
export const isStale = (connection: Connection): boolean => connection.scopes.length === 0
