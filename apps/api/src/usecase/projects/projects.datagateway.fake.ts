import type { ProjectContents, ProjectsDatagateway } from "@exagram/core/datagateway/projects.datagateway"
import type { NewProject, Project, VisibleProject } from "@exagram/core/entity/project"

export class FakeProjectsDatagateway implements ProjectsDatagateway {
	readonly projects: Project[] = []
	contents: ProjectContents = { artifactCount: 0, childCount: 0 }
	private seq = 0

	create(input: NewProject): Promise<Project> {
		const clash = this.projects.some(
			(p) => p.ownerId === input.ownerId && p.parentProjectId === input.parentProjectId && p.name === input.name,
		)
		if (clash) throw Object.assign(new Error("duplicate key"), { code: "23505" })
		this.seq += 1
		const project: Project = {
			...input,
			id: `p${this.seq}`,
			publishPolicy: "auto",
			linkPreview: "metadata",
			createdAt: new Date(),
		}
		this.projects.push(project)
		return Promise.resolve(project)
	}

	listByOwner(ownerId: string): Promise<Project[]> {
		return Promise.resolve(this.projects.filter((p) => p.ownerId === ownerId))
	}

	/** Grants live in another fake; tests that need a shared Project seed `sharedWith`. */
	readonly sharedWith = new Map<string, string[]>()

	listVisible(userId: string): Promise<VisibleProject[]> {
		return Promise.resolve(
			this.projects
				.filter((p) => p.ownerId === userId || (this.sharedWith.get(p.id) ?? []).includes(userId))
				.map((p) => ({ ...p, ownerName: p.ownerId, memberNames: this.sharedWith.get(p.id) ?? [] })),
		)
	}

	getById(id: string): Promise<Project | null> {
		return Promise.resolve(this.projects.find((p) => p.id === id) ?? null)
	}

	setPublishPolicy(id: string, ownerId: string, publishPolicy: Project["publishPolicy"]): Promise<Project | null> {
		const project = this.projects.find((p) => p.id === id && p.ownerId === ownerId)
		if (!project) return Promise.resolve(null)
		project.publishPolicy = publishPolicy
		return Promise.resolve(project)
	}

	setLinkPreview(id: string, ownerId: string, linkPreview: Project["linkPreview"]): Promise<Project | null> {
		const project = this.projects.find((p) => p.id === id && p.ownerId === ownerId)
		if (!project) return Promise.resolve(null)
		project.linkPreview = linkPreview
		return Promise.resolve(project)
	}

	rename(id: string, ownerId: string, name: string): Promise<Project | null> {
		const project = this.projects.find((p) => p.id === id && p.ownerId === ownerId)
		if (!project) return Promise.resolve(null)
		project.name = name
		return Promise.resolve(project)
	}

	move(id: string, ownerId: string, parentProjectId: string | null): Promise<Project | null> {
		const project = this.projects.find((p) => p.id === id && p.ownerId === ownerId)
		if (!project) return Promise.resolve(null)
		project.parentProjectId = parentProjectId
		return Promise.resolve(project)
	}

	deleteOwned(id: string, ownerId: string): Promise<boolean> {
		const index = this.projects.findIndex((p) => p.id === id && p.ownerId === ownerId)
		if (index < 0) return Promise.resolve(false)
		this.projects.splice(index, 1)
		return Promise.resolve(true)
	}

	countContents(): Promise<ProjectContents> {
		return Promise.resolve(this.contents)
	}
}
