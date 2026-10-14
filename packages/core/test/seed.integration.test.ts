import { expect, it } from "vitest"

import { withDb } from "./pg"
import { seedConnection, seedMembership, seedUser, seedWorkspace } from "./seed"

it("seeds a Connection in the Workspace its person is live in, whichever membership was written first", async () => {
	await withDb(async (sql) => {
		const gone = await seedWorkspace(sql, "Gone")
		const team = await seedWorkspace(sql, "Team")
		const ada = await seedUser(sql, { workspaceId: gone, email: "ada@x.test" })
		await seedMembership(sql, { userId: ada, workspaceId: gone, removed: true })
		await seedMembership(sql, { userId: ada, workspaceId: team })

		const connection = await seedConnection(sql, { userId: ada })

		expect(await sql`SELECT workspace_id FROM exagram.connections WHERE id = ${connection}`).toEqual([
			{ workspace_id: team },
		])
	})
})
