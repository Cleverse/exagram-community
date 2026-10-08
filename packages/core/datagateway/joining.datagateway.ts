import type { DomainLink, JoinMode, WorkspaceJoining } from "../entity/joining"

export interface JoiningDatagateway {
	get(workspaceId: string): Promise<WorkspaceJoining | null>
	lock(workspaceId: string): Promise<WorkspaceJoining | null>
	countSeatsUsed(workspaceId: string): Promise<number>
	soleWorkspaceNamingDomain(domain: string): Promise<{ workspaceId: string; joinMode: JoinMode } | null>
	getEnabledDomainLink(domainLinkId: string): Promise<DomainLink | null>
}
