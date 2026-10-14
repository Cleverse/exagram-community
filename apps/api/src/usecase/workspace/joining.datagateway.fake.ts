import type { JoiningDatagateway } from "@exagram/core/datagateway/joining.datagateway"
import type { DomainLink, JoiningSettings, JoinMode, WorkspaceJoining } from "@exagram/core/entity/joining"

/* eslint-disable @typescript-eslint/require-await -- an in-memory double for a Promise-returning port */
export class FakeJoiningDatagateway implements JoiningDatagateway {
	readonly workspaces = new Map<string, WorkspaceJoining>()
	private seq = 0

	constructor(
		private readonly countSeats: (workspaceId: string) => number = () => 0,
		private readonly options: { anyWorkspace?: boolean } = {},
	) {}

	add(workspaceId: string, overrides: Partial<WorkspaceJoining> = {}): WorkspaceJoining {
		const workspace: WorkspaceJoining = {
			workspaceName: "Acme",
			kind: "team",
			allowedDomain: null,
			joinMode: "invite",
			joinApproval: "admin",
			memberInvites: true,
			domainLinkEnabled: false,
			domainLinkId: this.nextLinkId(),
			defaultShareRole: "collaborate",
			seatLimit: null,
			...overrides,
		}
		this.workspaces.set(workspaceId, workspace)
		return workspace
	}

	async get(workspaceId: string): Promise<WorkspaceJoining | null> {
		const workspace =
			this.workspaces.get(workspaceId) ?? (this.options.anyWorkspace ? this.add(workspaceId) : undefined)
		return workspace ? { ...workspace } : null
	}

	async lock(workspaceId: string): Promise<WorkspaceJoining | null> {
		return this.get(workspaceId)
	}

	async update(workspaceId: string, settings: Omit<JoiningSettings, "domainLinkId">): Promise<void> {
		const workspace = this.workspaces.get(workspaceId)
		if (workspace) this.workspaces.set(workspaceId, { ...workspace, ...settings })
	}

	async resetDomainLink(workspaceId: string): Promise<string> {
		const workspace = this.workspaces.get(workspaceId)
		if (!workspace) throw new Error(`no workspace ${workspaceId}`)
		workspace.domainLinkId = this.nextLinkId()
		return workspace.domainLinkId
	}

	async countSeatsUsed(workspaceId: string): Promise<number> {
		return this.countSeats(workspaceId)
	}

	async soleWorkspaceNamingDomain(domain: string): Promise<{ workspaceId: string; joinMode: JoinMode } | null> {
		const naming = [...this.workspaces].filter(([, workspace]) => workspace.allowedDomain === domain)
		const [only] = naming
		return naming.length === 1 && only ? { workspaceId: only[0], joinMode: only[1].joinMode } : null
	}

	async getEnabledDomainLink(domainLinkId: string): Promise<DomainLink | null> {
		for (const [workspaceId, workspace] of this.workspaces) {
			if (workspace.domainLinkId !== domainLinkId || !workspace.domainLinkEnabled || workspace.allowedDomain === null)
				continue
			return { workspaceId, workspaceName: workspace.workspaceName, allowedDomain: workspace.allowedDomain }
		}
		return null
	}

	private nextLinkId(): string {
		this.seq += 1
		return `11111111-1111-4111-8111-${String(this.seq).padStart(12, "0")}`
	}
}
