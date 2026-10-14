import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const FILE = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../database/postgres/queries/exagram_notifications.sql",
)

const bodyOf = (sql: string, name: string): string => {
	const from = sql.indexOf(`-- name: ${name} :many`)
	expect(from, `${name} is in the file`).toBeGreaterThanOrEqual(0)
	const start = sql.indexOf("WITH pref AS (", from)
	const end = sql.indexOf("\nSELECT items.id", start)
	return sql.slice(start, end)
}

describe("the notification feed queries", () => {
	it("share one body, so the app feed and Notification Email read the same rows through the same predicates", () => {
		const sql = readFileSync(FILE, "utf8")
		const app = bodyOf(sql, "ListNotificationsSince")
		const email = bodyOf(sql, "ListNotificationEmailItems")

		expect(app.length).toBeGreaterThan(2000)
		expect(email).toBe(app)
	})
})
