import { MemberRemovedError } from "../../utils/refusal"

import { PostgresRepository } from "./db"
import {
	countProjectContents,
	deleteProject,
	getProjectById,
	insertProject,
	listProjectsByOwner,
	listVisibleProjects,
	moveProject,
	renameProject,
	setProjectLinkPreview,
	setProjectPublishPolicy,
} from "./gen/exagram_projects_sql"

import type { ProjectContents, ProjectsDatagateway } from "../../datagateway/projects.datagateway"
import type { NewProject, Project, VisibleProject } from "../../entity/project"
import type { Sql } from "postgres"

type ProjectRow = {
	id: string
	workspaceId: string
	ownerId: string
	parentProjectId: string | null
	name: string
	publishPolicy: string
	linkPreview: string
	sourceDescription?: string | null
	createdAt: Date
}

const toProject = (row: ProjectRow): Project => ({
	id: row.id,
	workspaceId: row.workspaceId,
	ownerId: row.ownerId,
	parentProjectId: row.parentProjectId,
	name: row.name,
	publishPolicy: row.publishPolicy as Project["publishPolicy"],
	linkPreview: row.linkPreview as Project["linkPreview"],
	sourceDescription: row.sourceDescription ?? null,
	createdAt: row.createdAt,
})

export class ProjectsRepository extends PostgresRepository implements ProjectsDatagateway {
	constructor(sql: Sql) {
		super(sql)
	}

	async create(input: NewProject): Promise<Project> {
		const row = await insertProject(this.sql, input)
		if (!row) throw new MemberRemovedError()
		return toProject(row as ProjectRow)
	}

	async listByOwner(ownerId: string): Promise<Project[]> {
		const rows = await listProjectsByOwner(this.sql, { ownerId })
		return rows.map((row) => toProject(row as ProjectRow))
	}

	async listVisible(userId: string, workspaceId: string): Promise<VisibleProject[]> {
		const rows = await listVisibleProjects(this.sql, { userId, workspaceId })
		return rows.map((row) => ({
			...toProject(row as ProjectRow),
			ownerName: row.ownerName,
			// NULL for a Viewer (the query hides the members from them), which the generated row type does not say.
			memberNames: row.memberNames as string[] | null,
		}))
	}

	async getById(id: string): Promise<Project | null> {
		const row = await getProjectById(this.sql, { id })
		return row ? toProject(row as ProjectRow) : null
	}

	async rename(id: string, ownerId: string, name: string): Promise<Project | null> {
		const row = await renameProject(this.sql, { id, ownerId, name })
		return row ? toProject(row as ProjectRow) : null
	}

	async move(id: string, ownerId: string, parentProjectId: string | null): Promise<Project | null> {
		const row = await moveProject(this.sql, { id, ownerId, parentProjectId })
		return row ? toProject(row as ProjectRow) : null
	}

	async setPublishPolicy(
		id: string,
		ownerId: string,
		publishPolicy: Project["publishPolicy"],
	): Promise<Project | null> {
		const row = await setProjectPublishPolicy(this.sql, { id, ownerId, publishPolicy })
		return row ? toProject(row as ProjectRow) : null
	}

	async setLinkPreview(id: string, ownerId: string, linkPreview: Project["linkPreview"]): Promise<Project | null> {
		const row = await setProjectLinkPreview(this.sql, { id, ownerId, linkPreview })
		return row ? toProject(row as ProjectRow) : null
	}

	async deleteOwned(id: string, ownerId: string): Promise<boolean> {
		const row = await deleteProject(this.sql, { id, ownerId })
		return row !== null
	}

	async countContents(id: string): Promise<ProjectContents> {
		const row = await countProjectContents(this.sql, { id })
		return { artifactCount: row?.artifactCount ?? 0, childCount: row?.childCount ?? 0 }
	}
}
