import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { NO_COLLABORATOR_IN_PERSONAL } from "../../entity/grant"
import { withDb } from "../../test/pg"
import {
	seedArtifact,
	seedConnection,
	seedGrant,
	seedEmptyPersonalWorkspace,
	seedProject,
	seedRevision,
	seedUser,
	seedWorkspace,
} from "../../test/seed"
import { personalHas } from "../../utils/personal-rule"

import { ArtifactsRepository } from "./artifacts.repository"
import { getArtifactUnfurl, getProjectUnfurl } from "./gen/exagram_unfurl_sql"
import { GrantsRepository } from "./grants.repository"
import { McpRepository } from "./mcp.repository"
import { ProjectsRepository } from "./projects.repository"
import { RevisionsRepository } from "./revisions.repository"

import type { Sql } from "postgres"

const REFUSED = (message: string) => ({ code: "EXP01", message })

const fixture = async (sql: Sql) => {
	const personal = await seedEmptyPersonalWorkspace(sql)
	const team = await seedWorkspace(sql, "Acme")
	const owner = await seedUser(sql, { workspaceId: personal, email: "solo@example.com", isAdmin: true })
	const boss = await seedUser(sql, { workspaceId: team, email: "boss@acme.test", isAdmin: true })
	const guest = await seedUser(sql, { workspaceId: team, email: "guest@acme.test" })
	const personalProject = await seedProject(sql, { workspaceId: personal, ownerId: owner, name: "Notes" })
	const teamProject = await seedProject(sql, { workspaceId: team, ownerId: boss, name: "Plans" })
	const personalFile = await seedArtifact(sql, { workspaceId: personal, ownerId: owner, title: "Mine" })
	const teamFile = await seedArtifact(sql, { workspaceId: team, ownerId: boss, title: "Ours" })
	return { personal, team, owner, boss, guest, personalProject, teamProject, personalFile, teamFile }
}

const soloWithLeftovers = async (sql: Sql, tag = "solo") => {
	const workspace = await seedWorkspace(sql, "Solo")
	const owner = await seedUser(sql, { workspaceId: workspace, email: `${tag}@example.com`, isAdmin: true })
	const other = await seedUser(sql, { workspaceId: await seedWorkspace(sql, "Else"), email: `${tag}-else@example.com` })
	const projectId = await seedProject(sql, { workspaceId: workspace, ownerId: owner, name: "P" })
	const artifactId = await seedArtifact(sql, { workspaceId: workspace, ownerId: owner, title: "A", projectId })
	await sql`UPDATE exagram.projects SET link_preview = 'generic' WHERE id = ${projectId}`
	const convert = () => sql`
		UPDATE exagram.workspaces SET kind = 'personal', redaction = 'off', default_share_role = 'view', link_preview = 'generic',
			member_invites = false WHERE id = ${workspace}`
	return { workspace, owner, other, projectId, artifactId, convert }
}

const MIGRATIONS = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../database/postgres/migrations",
)
const runHalf = async (sql: Sql, half: string): Promise<void> => {
	const connection = await sql.reserve()
	try {
		await connection.unsafe(await readFile(path.join(MIGRATIONS, half), "utf8")).simple()
	} finally {
		connection.release()
	}
}

const delay = (ms: number) => new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), ms))

const held = (sql: Sql, work: (tx: Sql) => Promise<unknown>) => {
	let release!: () => void
	let started!: () => void
	const gate = new Promise<void>((resolve) => (release = resolve))
	const running = new Promise<void>((resolve) => (started = resolve))
	const done = sql.begin(async (tx) => {
		try {
			await work(tx as unknown as Sql)
		} finally {
			started()
		}
		await gate
	})
	return { running, release, done }
}

const expectBlockedThenRelease = async (holder: { release: () => void }, pending: PromiseLike<unknown>) => {
	try {
		const outcome = await Promise.race([
			Promise.resolve(pending).then(
				() => "settled",
				() => "settled",
			),
			delay(400),
		])
		expect(outcome).toBe("waiting")
	} finally {
		holder.release()
	}
}

describe("Personal Workspace rules (ADR 0043, integration)", () => {
	describe("the Workspace row", () => {
		it.each([
			["redaction on", "redaction = 'on'", "A Personal Workspace has no redaction."],
			["Restricted Shares", "restricted_shares = true", "A Personal Workspace has no Restricted Shares."],
			["a Seat limit", "seat_limit = 5", "A Personal Workspace has no Seats."],
			["domain joining", "join_mode = 'domain'", "A Personal Workspace has no joining settings."],
			["a Domain Join Link", "domain_link_enabled = true", "A Personal Workspace has no joining settings."],
			["Member Invites", "member_invites = true", "A Personal Workspace has no joining settings."],
			[
				"a metadata Link Preview",
				"link_preview = 'metadata'",
				"A Personal Workspace shows every Link Preview as the generic card.",
			],
			[
				"a Collaborator default",
				"default_share_role = 'collaborate'",
				"A Personal Workspace shares as Viewer by default.",
			],
		])("refuses %s", async (_name, change, message) => {
			await withDb(async (sql) => {
				const { personal } = await fixture(sql)
				await expect(
					sql.unsafe(`UPDATE exagram.workspaces SET ${change} WHERE id = '${personal}'`),
				).rejects.toMatchObject(REFUSED(message))
			})
		})

		it("lets a Personal Workspace that holds a forbidden value change something else, and clear the value", async () => {
			await withDb(async (sql) => {
				const { personal } = await fixture(sql)
				await sql.begin(async (tx) => {
					await tx`SET LOCAL session_replication_role = replica`
					await tx`UPDATE exagram.workspaces SET redaction = 'on', seat_limit = 5, member_invites = true,
						default_share_role = 'edit', link_preview = 'metadata' WHERE id = ${personal}`
				})
				await sql`UPDATE exagram.workspaces SET name = 'Renamed', notification_email_enabled = false WHERE id = ${personal}`
				await expect(
					sql`UPDATE exagram.workspaces SET default_share_role = 'collaborate' WHERE id = ${personal}`,
				).rejects.toMatchObject(REFUSED("A Personal Workspace shares as Viewer by default."))
				await sql`UPDATE exagram.workspaces SET redaction = 'off', seat_limit = NULL, member_invites = false,
					default_share_role = 'view', link_preview = 'generic' WHERE id = ${personal}`
			})
		})

		it("refuses to be born with Team settings, and lets a Team keep every one of them", async () => {
			await withDb(async (sql) => {
				await expect(sql`INSERT INTO exagram.workspaces (name, kind) VALUES ('P', 'personal')`).rejects.toMatchObject(
					REFUSED("A Personal Workspace has no redaction."),
				)
				const { team } = await fixture(sql)
				await sql`UPDATE exagram.workspaces SET redaction = 'on', restricted_shares = true, seat_limit = 5,
					join_mode = 'domain', domain_link_enabled = true, default_share_role = 'collaborate' WHERE id = ${team}`
			})
		})
	})

	describe("a Team becoming a Personal Workspace", () => {
		it("needs the Workspace row to carry Personal settings", async () => {
			await withDb(async (sql) => {
				const { workspace } = await soloWithLeftovers(sql)
				await expect(
					sql`UPDATE exagram.workspaces SET kind = 'personal' WHERE id = ${workspace}`,
				).rejects.toMatchObject({ code: "EXP01" })
			})
		})

		it("goes through when nothing the rules forbid is left", async () => {
			await withDb(async (sql) => {
				const { workspace, convert } = await soloWithLeftovers(sql)
				await convert()
				const [row] = await sql<{ kind: string }[]>`SELECT kind FROM exagram.workspaces WHERE id = ${workspace}`
				expect(row!.kind).toBe("personal")
			})
		})

		it.each([
			[
				"an Invite",
				(sql: Sql, fx: { workspace: string; owner: string }) => sql`
					INSERT INTO exagram.workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
					VALUES (${fx.workspace}, 'x@example.com', 'member', 'hash', ${fx.owner}, now() + interval '7 days')`,
				personalHas("Invites"),
			],
			[
				"a Join Request",
				(sql: Sql, fx: { workspace: string }) => sql`
					INSERT INTO exagram.join_requests (workspace_id, email, name, password_hash, via)
					VALUES (${fx.workspace}, 'x@example.com', 'X', 'hash', 'domain')`,
				personalHas("Join Requests"),
			],
			[
				"an Allowed Domain",
				(sql: Sql, fx: { workspace: string }) =>
					sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${fx.workspace}, 'solo.test')`,
				personalHas("Allowed Domain"),
			],
			[
				"an allowlisted email",
				(sql: Sql, fx: { workspace: string }) => sql`
					INSERT INTO exagram.share_allowed_emails (workspace_id, email, kind, can_create, source_created_at)
					VALUES (${fx.workspace}, 'x@example.com', 'email', false, now())`,
				personalHas("Restricted Shares"),
			],
			[
				"a Collaborator Grant",
				(sql: Sql, fx: { artifactId: string; owner: string; other: string }) => sql`
					INSERT INTO exagram.grants (artifact_id, grantee_id, role, created_by)
					VALUES (${fx.artifactId}, ${fx.other}, 'collaborate', ${fx.owner})`,
				NO_COLLABORATOR_IN_PERSONAL,
			],
			[
				"org General Access",
				(sql: Sql, fx: { artifactId: string }) =>
					sql`UPDATE exagram.artifacts SET general_access = 'org' WHERE id = ${fx.artifactId}`,
				"A Personal Workspace cannot open an Artifact to everyone in the Workspace.",
			],
			[
				"a manual folder Publish Policy",
				(sql: Sql, fx: { projectId: string }) =>
					sql`UPDATE exagram.projects SET publish_policy = 'manual' WHERE id = ${fx.projectId}`,
				personalHas("Publish Policy"),
			],
			[
				"an Artifact Publish Policy",
				(sql: Sql, fx: { artifactId: string }) =>
					sql`UPDATE exagram.artifacts SET publish_policy = 'auto' WHERE id = ${fx.artifactId}`,
				personalHas("Publish Policy"),
			],
			[
				"a folder redaction setting",
				(sql: Sql, fx: { projectId: string }) =>
					sql`UPDATE exagram.projects SET redaction = 'off' WHERE id = ${fx.projectId}`,
				personalHas("redaction"),
			],
			[
				"an Artifact redaction setting",
				(sql: Sql, fx: { artifactId: string }) =>
					sql`UPDATE exagram.artifacts SET redaction = 'on' WHERE id = ${fx.artifactId}`,
				personalHas("redaction"),
			],
			[
				"Restricted Shares on a folder",
				(sql: Sql, fx: { projectId: string }) =>
					sql`UPDATE exagram.projects SET restricted_shares = true WHERE id = ${fx.projectId}`,
				personalHas("Restricted Shares"),
			],
			[
				"a folder previewing as metadata",
				(sql: Sql, fx: { projectId: string }) =>
					sql`UPDATE exagram.projects SET link_preview = 'metadata' WHERE id = ${fx.projectId}`,
				"A Personal Workspace shows every Link Preview as the generic card.",
			],
			[
				"a Pending Revision",
				async (sql: Sql, fx: { artifactId: string; owner: string }) => {
					await seedRevision(sql, { artifactId: fx.artifactId, seq: 1, authorUserId: fx.owner })
				},
				personalHas("Pending Revisions"),
			],
		])("is refused while the Workspace still holds %s", async (_name, plant, message) => {
			await withDb(async (sql) => {
				const fx = await soloWithLeftovers(sql)
				await plant(sql, fx as never)
				await expect(fx.convert()).rejects.toMatchObject(REFUSED(message))
			})
		})
	})

	describe("a Team becoming a Personal Workspace, beyond the Workspace row", () => {
		it("is refused for every Workspace in the statement when one still holds a forbidden thing", async () => {
			await withDb(async (sql) => {
				const clean = await soloWithLeftovers(sql, "clean")
				const dirty = await soloWithLeftovers(sql, "dirty")
				await sql`UPDATE exagram.artifacts SET restricted_shares = true WHERE id = ${dirty.artifactId}`
				await expect(
					sql`UPDATE exagram.workspaces SET kind = 'personal', redaction = 'off', default_share_role = 'view', link_preview = 'generic',
						member_invites = false WHERE id IN (${clean.workspace}, ${dirty.workspace})`,
				).rejects.toMatchObject(REFUSED(personalHas("Restricted Shares")))
				const kinds = await sql<{ kind: string }[]>`
					SELECT kind FROM exagram.workspaces WHERE id IN (${clean.workspace}, ${dirty.workspace})`
				expect(kinds.map((row) => row.kind)).toEqual(["team", "team"])
			})
		})

		it("is refused while a folder holds a Collaborator Grant", async () => {
			await withDb(async (sql) => {
				const fx = await soloWithLeftovers(sql)
				await seedGrant(sql, { projectId: fx.projectId, granteeId: fx.other, createdBy: fx.owner, role: "collaborate" })
				await expect(fx.convert()).rejects.toMatchObject(REFUSED(NO_COLLABORATOR_IN_PERSONAL))
			})
		})

		it("waits for a write in flight that sets a forbidden value, then sees it and refuses", async () => {
			await withDb(async (sql) => {
				const fx = await soloWithLeftovers(sql)
				const writer = held(
					sql,
					(tx) => tx`UPDATE exagram.artifacts SET general_access = 'org' WHERE id = ${fx.artifactId}`,
				)
				await writer.running
				const flip = fx.convert()
				await expectBlockedThenRelease(writer, flip)
				await writer.done
				await expect(flip).rejects.toMatchObject(
					REFUSED("A Personal Workspace cannot open an Artifact to everyone in the Workspace."),
				)
			})
		})

		it("makes a forbidden write that meets the flip wait for it, then refuses it", async () => {
			await withDb(async (sql) => {
				const fx = await soloWithLeftovers(sql)
				const flipper = held(
					sql,
					(tx) => tx`
						UPDATE exagram.workspaces SET kind = 'personal', redaction = 'off', default_share_role = 'view', link_preview = 'generic',
							member_invites = false WHERE id = ${fx.workspace}`,
				)
				await flipper.running
				const write = sql`UPDATE exagram.artifacts SET general_access = 'org' WHERE id = ${fx.artifactId}`
				await expectBlockedThenRelease(flipper, write)
				await flipper.done
				await expect(write).rejects.toMatchObject(
					REFUSED("A Personal Workspace cannot open an Artifact to everyone in the Workspace."),
				)
			})
		})
	})

	describe("running the migration over a Personal Workspace that already exists", () => {
		it("leaves its Link Previews generic, and a folder that went metadata in between", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				await runHalf(sql, "000040_personal_rules.down.sql")
				await sql`UPDATE exagram.projects SET link_preview = 'metadata' WHERE id = ${fx.personalProject}`
				await runHalf(sql, "000040_personal_rules.up.sql")
				const [workspace] = await sql<{ linkPreview: string }[]>`
					SELECT link_preview AS "linkPreview" FROM exagram.workspaces WHERE id = ${fx.personal}`
				const [folder] = await sql<{ linkPreview: string }[]>`
					SELECT link_preview AS "linkPreview" FROM exagram.projects WHERE id = ${fx.personalProject}`
				expect([workspace!.linkPreview, folder!.linkPreview]).toEqual(["generic", "generic"])
				await sql`UPDATE exagram.workspaces SET name = 'Renamed' WHERE id = ${fx.personal}`
			})
		})

		it("holds back only reads of workspaces while it runs, so reads of the tables that gain a trigger go on", async () => {
			await withDb(async (sql) => {
				await fixture(sql)
				await runHalf(sql, "000040_personal_rules.down.sql")
				const up = (await readFile(path.join(MIGRATIONS, "000040_personal_rules.up.sql"), "utf8"))
					.replace(/^BEGIN;\s*/, "")
					.replace(/\s*COMMIT;\s*$/, "")
				const migration = held(sql, (tx) => tx.unsafe(up).simple())
				const reader = await sql.reserve()
				try {
					await migration.running
					await reader`SET lock_timeout = '1s'`
					for (const table of [
						"grants",
						"artifacts",
						"projects",
						"workspace_invites",
						"join_requests",
						"share_allowed_emails",
						"workspace_org_domains",
					]) {
						await reader.unsafe(`SELECT count(*) FROM exagram.${table}`)
					}
					await expect(reader`SELECT count(*) FROM exagram.workspaces`).rejects.toMatchObject({ code: "55P03" })
				} finally {
					await reader`RESET lock_timeout`
					reader.release()
					migration.release()
				}
				await migration.done
			})
		})
	})

	describe("Team-only features", () => {
		it("refuses an Invite, a Join Request, an Allowed Domain and an allowlisted email, and allows each in a Team", async () => {
			await withDb(async (sql) => {
				const { personal, team, owner, boss } = await fixture(sql)
				const invite = (workspaceId: string, inviter: string) => sql`
					INSERT INTO exagram.workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
					VALUES (${workspaceId}, 'x@example.com', 'member', ${`hash-${workspaceId}`}, ${inviter}, now() + interval '7 days')`
				const request = (workspaceId: string) => sql`
					INSERT INTO exagram.join_requests (workspace_id, email, name, password_hash, via)
					VALUES (${workspaceId}, 'x@example.com', 'X', 'hash', 'domain')`
				const domain = (workspaceId: string) =>
					sql`INSERT INTO exagram.workspace_org_domains (workspace_id, domain) VALUES (${workspaceId}, 'acme.test')`
				const allowed = (workspaceId: string) => sql`
					INSERT INTO exagram.share_allowed_emails (workspace_id, email, kind, can_create, source_created_at)
					VALUES (${workspaceId}, 'x@example.com', 'email', false, now())`

				await expect(invite(personal, owner)).rejects.toMatchObject(REFUSED(personalHas("Invites")))
				await expect(request(personal)).rejects.toMatchObject(REFUSED(personalHas("Join Requests")))
				await expect(domain(personal)).rejects.toMatchObject(REFUSED(personalHas("Allowed Domain")))
				await expect(allowed(personal)).rejects.toMatchObject(REFUSED(personalHas("Restricted Shares")))

				await invite(team, boss)
				await request(team)
				await domain(team)
				await allowed(team)
			})
		})
	})

	describe("what a Personal Workspace is born with and what moves into it", () => {
		it("refuses an Artifact or folder inserted with a forbidden value, and allows the same in a Team", async () => {
			await withDb(async (sql) => {
				const { personal, team, owner, boss } = await fixture(sql)
				const artifact = (workspaceId: string, ownerId: string, column: string, value: string) =>
					sql.unsafe(
						`INSERT INTO exagram.artifacts (workspace_id, owner_id, kind, title, ${column}) VALUES ($1, $2, 'doc', 'T', ${value})`,
						[workspaceId, ownerId],
					)
				const folder = (workspaceId: string, ownerId: string, column: string, value: string) =>
					sql.unsafe(
						`INSERT INTO exagram.projects (workspace_id, owner_id, name, ${column}) VALUES ($1, $2, 'F ${column}', ${value})`,
						[workspaceId, ownerId],
					)
				await expect(artifact(personal, owner, "general_access", "'org'")).rejects.toMatchObject({ code: "EXP01" })
				await expect(artifact(personal, owner, "publish_policy", "'manual'")).rejects.toMatchObject(
					REFUSED(personalHas("Publish Policy")),
				)
				await expect(artifact(personal, owner, "redaction", "'on'")).rejects.toMatchObject(
					REFUSED(personalHas("redaction")),
				)
				await expect(folder(personal, owner, "publish_policy", "'manual'")).rejects.toMatchObject(
					REFUSED(personalHas("Publish Policy")),
				)
				await expect(folder(personal, owner, "restricted_shares", "true")).rejects.toMatchObject(
					REFUSED(personalHas("Restricted Shares")),
				)
				await expect(folder(personal, owner, "link_preview", "'metadata'")).rejects.toMatchObject(
					REFUSED("A Personal Workspace shows every Link Preview as the generic card."),
				)
				await artifact(team, boss, "publish_policy", "'manual'")
				await folder(team, boss, "publish_policy", "'manual'")
				await folder(team, boss, "link_preview", "'generic'")
			})
		})

		it("leaves a row that names no Workspace to the foreign key, not to a Personal sentence", async () => {
			await withDb(async (sql) => {
				const { owner } = await fixture(sql)
				const nowhere = randomUUID()
				await expect(
					sql`INSERT INTO exagram.projects (workspace_id, owner_id, name, link_preview) VALUES (${nowhere}, ${owner}, 'F', 'metadata')`,
				).rejects.toMatchObject({ code: "23503" })
				await expect(
					sql`INSERT INTO exagram.artifacts (workspace_id, owner_id, kind, title, publish_policy) VALUES (${nowhere}, ${owner}, 'doc', 'T', 'manual')`,
				).rejects.toMatchObject({ code: "23503" })
			})
		})

		it("refuses moving an Invite, a Join Request or an allowlisted email into a Personal Workspace", async () => {
			await withDb(async (sql) => {
				const { personal, team, boss } = await fixture(sql)
				await sql`INSERT INTO exagram.workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
					VALUES (${team}, 'x@example.com', 'member', 'hash', ${boss}, now() + interval '7 days')`
				await sql`INSERT INTO exagram.join_requests (workspace_id, email, name, password_hash, via)
					VALUES (${team}, 'x@example.com', 'X', 'hash', 'domain')`
				await sql`INSERT INTO exagram.share_allowed_emails (workspace_id, email, kind, can_create, source_created_at)
					VALUES (${team}, 'x@example.com', 'email', false, now())`
				for (const table of ["workspace_invites", "join_requests", "share_allowed_emails"]) {
					await expect(sql.unsafe(`UPDATE exagram.${table} SET workspace_id = $1`, [personal])).rejects.toMatchObject({
						code: "EXP01",
					})
				}
			})
		})
	})

	describe("roles", () => {
		it.each(["artifact", "project"] as const)(
			"refuses a Collaborator Grant on a Personal %s, at insert and at update",
			async (target) => {
				await withDb(async (sql) => {
					const fx = await fixture(sql)
					const subject = target === "artifact" ? { artifactId: fx.personalFile } : { projectId: fx.personalProject }
					await expect(
						seedGrant(sql, { ...subject, granteeId: fx.guest, createdBy: fx.owner, role: "collaborate" }),
					).rejects.toMatchObject(REFUSED(NO_COLLABORATOR_IN_PERSONAL))

					const viewer = await seedGrant(sql, { ...subject, granteeId: fx.guest, createdBy: fx.owner, role: "view" })
					await expect(sql`UPDATE exagram.grants SET role = 'collaborate' WHERE id = ${viewer}`).rejects.toMatchObject(
						REFUSED(NO_COLLABORATOR_IN_PERSONAL),
					)
					await sql`UPDATE exagram.grants SET role = 'edit' WHERE id = ${viewer}`
				})
			},
		)

		it("keeps Collaborator in a Team", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				await seedGrant(sql, { artifactId: fx.teamFile, granteeId: fx.guest, createdBy: fx.boss, role: "collaborate" })
			})
		})

		it("answers an AI tool's change to Collaborator as refused, with the Grant untouched", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const mcp = new McpRepository(sql)
				const change = async (artifactId: string, ownerId: string, granteeId: string) => {
					const grantId = await seedGrant(sql, { artifactId, granteeId, createdBy: ownerId, role: "view" })
					const connectionId = await seedConnection(sql, { userId: ownerId, scopes: ["read", "manage"] })
					return { grantId, changed: await mcp.updateGrantRole(connectionId, grantId, "collaborate") }
				}
				const mine = await change(fx.personalFile, fx.owner, fx.guest)
				expect(mine.changed).toBeNull()
				const [row] = await sql<{ role: string }[]>`SELECT role FROM exagram.grants WHERE id = ${mine.grantId}`
				expect(row!.role).toBe("view")
				expect((await change(fx.teamFile, fx.boss, fx.guest)).changed?.role).toBe("collaborate")
			})
		})
	})

	describe("General Access, Publish Policy, redaction and Restricted Shares on Artifacts and folders", () => {
		it("lets a Personal Artifact be Restricted or Anyone, and refuses org", async () => {
			await withDb(async (sql) => {
				const { personalFile, teamFile, owner } = await fixture(sql)
				await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${personalFile}`
				await sql`UPDATE exagram.artifacts SET general_access = 'restricted' WHERE id = ${personalFile}`
				await expect(new ArtifactsRepository(sql).setGeneralAccess(personalFile, owner, "org")).rejects.toMatchObject(
					REFUSED("A Personal Workspace cannot open an Artifact to everyone in the Workspace."),
				)
				await sql`UPDATE exagram.artifacts SET general_access = 'org' WHERE id = ${teamFile}`
			})
		})

		it("refuses a Publish Policy, a redaction override and Restricted Shares on a Personal Artifact", async () => {
			await withDb(async (sql) => {
				const { personalFile, teamFile } = await fixture(sql)
				for (const [change, message] of [
					["publish_policy = 'manual'", personalHas("Publish Policy")],
					["publish_policy = 'auto'", personalHas("Publish Policy")],
					["redaction = 'on'", personalHas("redaction")],
					["redaction = 'off'", personalHas("redaction")],
					["restricted_shares = true", personalHas("Restricted Shares")],
				] as const) {
					await expect(
						sql.unsafe(`UPDATE exagram.artifacts SET ${change} WHERE id = '${personalFile}'`),
					).rejects.toMatchObject(REFUSED(message))
					await sql.unsafe(`UPDATE exagram.artifacts SET ${change} WHERE id = '${teamFile}'`)
				}
			})
		})

		it("refuses a manual Publish Policy, a redaction override and Restricted Shares on a Personal folder", async () => {
			await withDb(async (sql) => {
				const { personalProject, teamProject } = await fixture(sql)
				await sql`UPDATE exagram.projects SET publish_policy = 'auto' WHERE id = ${personalProject}`
				for (const [change, message] of [
					["publish_policy = 'manual'", personalHas("Publish Policy")],
					["redaction = 'on'", personalHas("redaction")],
					["restricted_shares = true", personalHas("Restricted Shares")],
				] as const) {
					await expect(
						sql.unsafe(`UPDATE exagram.projects SET ${change} WHERE id = '${personalProject}'`),
					).rejects.toMatchObject(REFUSED(message))
					await sql.unsafe(`UPDATE exagram.projects SET ${change} WHERE id = '${teamProject}'`)
				}
			})
		})

		it("lets a Workspace that holds a forbidden value change everything else, and clear the value", async () => {
			await withDb(async (sql) => {
				const { workspace, projectId, artifactId } = await soloWithLeftovers(sql)
				await sql.begin(async (tx) => {
					await tx`SET LOCAL session_replication_role = replica`
					await tx`UPDATE exagram.projects SET publish_policy = 'manual', redaction = 'on', link_preview = 'metadata'
						WHERE id = ${projectId}`
					await tx`UPDATE exagram.artifacts SET publish_policy = 'manual', redaction = 'on', general_access = 'org'
						WHERE id = ${artifactId}`
					await tx`UPDATE exagram.workspaces SET kind = 'personal', redaction = 'off', default_share_role = 'view', link_preview = 'generic',
						member_invites = false WHERE id = ${workspace}`
				})
				const effective = async () =>
					(
						await sql<{ policy: string; redaction: boolean }[]>`
							SELECT exagram.effective_publish_policy(${artifactId}) AS policy,
							       exagram.effective_redaction(${artifactId}) AS redaction`
					)[0]
				expect(await effective()).toEqual({ policy: "auto", redaction: false })
				expect(await getArtifactUnfurl(sql, { id: artifactId })).toBeNull()

				await sql`UPDATE exagram.artifacts SET general_access = 'anyone' WHERE id = ${artifactId}`
				await sql`UPDATE exagram.artifacts SET publish_policy = NULL WHERE id = ${artifactId}`
				await sql`UPDATE exagram.artifacts SET redaction = NULL WHERE id = ${artifactId}`
				await sql`UPDATE exagram.projects SET publish_policy = 'auto' WHERE id = ${projectId}`
				await sql`UPDATE exagram.projects SET redaction = NULL WHERE id = ${projectId}`
			})
		})
	})

	describe("Link Previews", () => {
		it("starts a folder on its Workspace's card, and only a Team's folder may change it", async () => {
			await withDb(async (sql) => {
				const { personal, team, owner, boss } = await fixture(sql)
				const projects = new ProjectsRepository(sql)
				const mine = await projects.create({
					workspaceId: personal,
					ownerId: owner,
					parentProjectId: null,
					name: "New",
				})
				const ours = await projects.create({ workspaceId: team, ownerId: boss, parentProjectId: null, name: "New" })
				expect([mine.linkPreview, ours.linkPreview]).toEqual(["generic", "metadata"])
				await expect(projects.setLinkPreview(mine.id, owner, "metadata")).rejects.toMatchObject(
					REFUSED("A Personal Workspace shows every Link Preview as the generic card."),
				)
				expect((await projects.setLinkPreview(mine.id, owner, "generic"))?.linkPreview).toBe("generic")
				expect((await projects.setLinkPreview(ours.id, boss, "generic"))?.linkPreview).toBe("generic")
			})
		})

		it("previews a Personal Artifact and folder as the generic card, in a folder or not, and a Team's as before", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const inFolder = await seedArtifact(sql, {
					workspaceId: fx.personal,
					ownerId: fx.owner,
					title: "Filed",
					projectId: fx.personalProject,
				})
				expect(await getArtifactUnfurl(sql, { id: fx.personalFile })).toBeNull()
				expect(await getArtifactUnfurl(sql, { id: inFolder })).toBeNull()
				expect(await getProjectUnfurl(sql, { id: fx.personalProject })).toBeNull()
				expect(await getArtifactUnfurl(sql, { id: fx.teamFile })).toMatchObject({ title: "Ours" })
				expect(await getProjectUnfurl(sql, { id: fx.teamProject })).toMatchObject({ name: "Plans" })
			})
		})
	})

	describe("publishing", () => {
		it("publishes a restore on arrival in a Personal Workspace, and leaves a Team's waiting", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const revisions = new RevisionsRepository(sql)
				const restore = async (artifactId: string, authorId: string) => {
					const id = await seedRevision(sql, { artifactId, seq: 1, authorUserId: authorId })
					return { id, published: await revisions.publishInPersonal(id, authorId) }
				}
				const mine = await restore(fx.personalFile, fx.owner)
				expect(mine.published?.id).toBe(mine.id)
				expect(mine.published?.status).toBe("approved")
				const ours = await restore(fx.teamFile, fx.boss)
				expect(ours.published).toBeNull()
			})
		})

		it("publishes a Connection's body with a placeholder in a Personal Workspace only", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const mcp = new McpRepository(sql)
				const write = async (artifactId: string, userId: string, hasPlaceholders: boolean) => {
					const connectionId = await seedConnection(sql, { userId, scopes: ["write"] })
					const revisionId = await seedRevision(sql, {
						artifactId,
						seq: 1,
						authorUserId: userId,
						authorConnectionId: connectionId,
					})
					return mcp.publishOnUpload(connectionId, revisionId, hasPlaceholders)
				}
				expect(await write(fx.personalFile, fx.owner, true)).not.toBeNull()
				expect(await write(fx.teamFile, fx.boss, true)).toBeNull()
			})
		})
	})

	describe("sharing by email", () => {
		it("makes a bare account for an email nobody holds, with no membership, and drops it with its last Grant", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const grants = new GrantsRepository(sql)
				const inviteeId = await grants.insertInvitedMember(fx.personal, "New@Example.com")
				expect(inviteeId).not.toBeNull()
				expect(await sql`SELECT 1 FROM exagram.memberships WHERE user_id = ${inviteeId}`).toHaveLength(0)

				const grantId = await seedGrant(sql, {
					artifactId: fx.personalFile,
					granteeId: inviteeId!,
					createdBy: fx.owner,
					role: "view",
				})
				await grants.releaseInvitedMembership(inviteeId!, fx.personal)
				expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${inviteeId}`).toHaveLength(1)

				await sql`DELETE FROM exagram.grants WHERE id = ${grantId}`
				await grants.releaseInvitedMembership(inviteeId!, fx.personal)
				expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${inviteeId}`).toHaveLength(0)
			})
		})

		it("still makes an invited membership for a Team", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const inviteeId = await new GrantsRepository(sql).insertInvitedMember(fx.team, "new@example.com")
				const [row] = await sql<{ kind: string; invited: boolean }[]>`
					SELECT kind, invited_at IS NOT NULL AS invited FROM exagram.memberships WHERE user_id = ${inviteeId}`
				expect(row).toEqual({ kind: "team", invited: true })
			})
		})

		it("moves a bare account to a Team that invites it, so that Team's Invite can claim it", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const grants = new GrantsRepository(sql)
				const inviteeId = (await grants.insertInvitedMember(fx.personal, "new@example.com"))!
				await seedGrant(sql, { artifactId: fx.personalFile, granteeId: inviteeId, createdBy: fx.owner, role: "view" })
				expect(await grants.insertInvitedMember(fx.team, "new@example.com")).toBe(inviteeId)
				const [row] = await sql<
					{ home: string }[]
				>`SELECT workspace_id AS home FROM exagram.users WHERE id = ${inviteeId}`
				expect(row!.home).toBe(fx.team)
				const [membership] = await sql<{ workspace_id: string }[]>`
					SELECT workspace_id FROM exagram.memberships WHERE user_id = ${inviteeId}`
				expect(membership!.workspace_id).toBe(fx.team)
			})
		})

		it("moves a bare account to the Team that still invites it when the Personal Workspace lets go", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const grants = new GrantsRepository(sql)
				const inviteeId = (await grants.insertInvitedMember(fx.personal, "new@example.com"))!
				const grantId = await seedGrant(sql, {
					artifactId: fx.personalFile,
					granteeId: inviteeId,
					createdBy: fx.owner,
					role: "view",
				})
				await sql`INSERT INTO exagram.memberships (user_id, workspace_id, kind, role, invited_at)
					VALUES (${inviteeId}, ${fx.team}, 'team', 'member', now())`
				await sql`DELETE FROM exagram.grants WHERE id = ${grantId}`
				await grants.releaseInvitedMembership(inviteeId, fx.personal)
				const [row] = await sql<
					{ home: string }[]
				>`SELECT workspace_id AS home FROM exagram.users WHERE id = ${inviteeId}`
				expect(row!.home).toBe(fx.team)
			})
		})

		it("moves a bare account back to a Personal Workspace that still shares with it when a Team lets go", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const grants = new GrantsRepository(sql)
				const inviteeId = (await grants.insertInvitedMember(fx.personal, "new@example.com"))!
				await seedGrant(sql, { artifactId: fx.personalFile, granteeId: inviteeId, createdBy: fx.owner, role: "view" })
				expect(await grants.insertInvitedMember(fx.team, "new@example.com")).toBe(inviteeId)
				await grants.releaseInvitedMembership(inviteeId, fx.team)
				const [row] = await sql<
					{ home: string }[]
				>`SELECT workspace_id AS home FROM exagram.users WHERE id = ${inviteeId}`
				expect(row!.home).toBe(fx.personal)
				expect(await sql`SELECT 1 FROM exagram.memberships WHERE user_id = ${inviteeId}`).toHaveLength(0)
			})
		})

		it("never deletes an account that has signed in with Google", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const grants = new GrantsRepository(sql)
				const inviteeId = (await grants.insertInvitedMember(fx.personal, "new@example.com"))!
				await sql`INSERT INTO exagram.user_identities (user_id, provider, subject, email)
					VALUES (${inviteeId}, 'google', 'new-sub', 'new@example.com')`
				await grants.releaseInvitedMembership(inviteeId, fx.personal)
				expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${inviteeId}`).toHaveLength(1)
			})
		})

		it("keeps the Grant of a share that is racing the release of the account's last other Grant", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const second = await seedEmptyPersonalWorkspace(sql, { name: "Second" })
				const secondOwner = await seedUser(sql, { workspaceId: second, email: "second@example.com", isAdmin: true })
				const secondFile = await seedArtifact(sql, { workspaceId: second, ownerId: secondOwner, title: "Theirs" })
				const inviteeId = (await new GrantsRepository(sql).insertInvitedMember(fx.personal, "new@example.com"))!

				const sharing = held(sql, async (tx) => {
					const grants = new GrantsRepository(tx)
					expect(await grants.insertInvitedMember(second, "new@example.com")).toBe(inviteeId)
					await seedGrant(tx, { artifactId: secondFile, granteeId: inviteeId, createdBy: secondOwner, role: "view" })
				})
				await sharing.running
				const releasing = sql.begin((tx) =>
					new GrantsRepository(tx as unknown as Sql).releaseInvitedMembership(inviteeId, fx.personal),
				)
				await expectBlockedThenRelease(sharing, releasing)
				await sharing.done
				await releasing
				expect(await sql`SELECT 1 FROM exagram.grants WHERE grantee_id = ${inviteeId}`).toHaveLength(1)
				expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${inviteeId}`).toHaveLength(1)
			})
		})

		it("sweeps a bare account whose Grants went by cascade, and spares one a share is taking", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const grants = new GrantsRepository(sql)
				const later = new Date(Date.now() + 60_000)
				const gone = (await grants.insertInvitedMember(fx.personal, "gone@example.com"))!
				expect(await grants.deleteOrphanInvitedMembers(later)).toBe(1)
				expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${gone}`).toHaveLength(0)

				const spared = (await grants.insertInvitedMember(fx.personal, "spared@example.com"))!
				const sharing = held(sql, async (tx) => {
					expect(await new GrantsRepository(tx).insertInvitedMember(fx.personal, "spared@example.com")).toBe(spared)
				})
				await sharing.running
				try {
					expect(await grants.deleteOrphanInvitedMembers(later)).toBe(0)
				} finally {
					sharing.release()
				}
				await sharing.done
				expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${spared}`).toHaveLength(1)
				expect(await grants.deleteOrphanInvitedMembers(later)).toBe(1)
			})
		})

		it("keeps a bare account while another Personal Workspace still shares with it, and drops it with the last one", async () => {
			await withDb(async (sql) => {
				const fx = await fixture(sql)
				const second = await seedEmptyPersonalWorkspace(sql, { name: "Second" })
				const secondOwner = await seedUser(sql, { workspaceId: second, email: "second@example.com", isAdmin: true })
				const secondFile = await seedArtifact(sql, { workspaceId: second, ownerId: secondOwner, title: "Theirs" })
				const grants = new GrantsRepository(sql)
				const inviteeId = (await grants.insertInvitedMember(fx.personal, "new@example.com"))!
				expect(await grants.insertInvitedMember(second, "new@example.com")).toBe(inviteeId)
				const first = await seedGrant(sql, {
					artifactId: fx.personalFile,
					granteeId: inviteeId,
					createdBy: fx.owner,
					role: "view",
				})
				const other = await seedGrant(sql, {
					artifactId: secondFile,
					granteeId: inviteeId,
					createdBy: secondOwner,
					role: "view",
				})

				await sql`DELETE FROM exagram.grants WHERE id = ${first}`
				await grants.releaseInvitedMembership(inviteeId, fx.personal)
				expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${inviteeId}`).toHaveLength(1)

				await sql`DELETE FROM exagram.grants WHERE id = ${other}`
				await grants.releaseInvitedMembership(inviteeId, second)
				expect(await sql`SELECT 1 FROM exagram.users WHERE id = ${inviteeId}`).toHaveLength(0)
			})
		})
	})
})
