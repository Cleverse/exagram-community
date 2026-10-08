import { consentContract, coreContract } from "@exagram/core/contract"

import { AccessRequestsRouter } from "./routes/access-requests"
import { ApprovalsRouter } from "./routes/approvals"
import { ArtifactsRouter } from "./routes/artifacts"
import { AuthRouter } from "./routes/auth"
import { CommentsRouter } from "./routes/comments"
import { ConnectionsRouter } from "./routes/connections"
import { EventsRouter } from "./routes/events"
import { GrantsRouter } from "./routes/grants"
import { LedgerRouter } from "./routes/ledger"
import { LinksRouter } from "./routes/links"
import { NotificationsRouter } from "./routes/notifications"
import { ProjectsRouter } from "./routes/projects"
import { RevisionsRouter } from "./routes/revisions"
import { WorkspaceRouter } from "./routes/workspace"
import { createRawClient } from "./utils/rawClient"

import type { ContractRouterClient } from "@orpc/contract"

export class ExagramApiClient {
	readonly accessRequests: AccessRequestsRouter
	readonly approvals: ApprovalsRouter
	readonly artifacts: ArtifactsRouter
	readonly auth: AuthRouter
	readonly comments: CommentsRouter
	readonly connections: ConnectionsRouter
	readonly events: EventsRouter
	readonly grants: GrantsRouter
	readonly ledger: LedgerRouter
	readonly links: LinksRouter
	readonly notifications: NotificationsRouter
	readonly projects: ProjectsRouter
	readonly revisions: RevisionsRouter
	readonly workspace: WorkspaceRouter
	/** Kept so a subclass can build more routers from it. */
	protected readonly rawClient: ContractRouterClient<typeof coreContract>

	/**
	 * `baseApiUrl` is the api origin plus `/v1`; `originUrl` is the same api origin with nothing
	 * appended, which is where the consent procedures answer.
	 */
	constructor(baseApiUrl: string, originUrl: string) {
		const client = createRawClient(coreContract, baseApiUrl)
		this.rawClient = client
		const consent = createRawClient(consentContract, originUrl)

		this.accessRequests = new AccessRequestsRouter(client)
		this.approvals = new ApprovalsRouter(client)
		this.artifacts = new ArtifactsRouter(client)
		this.auth = new AuthRouter(client)
		this.comments = new CommentsRouter(client)
		this.connections = new ConnectionsRouter(client, consent)
		this.events = new EventsRouter(client)
		this.grants = new GrantsRouter(client)
		this.ledger = new LedgerRouter(client)
		this.links = new LinksRouter(client)
		this.notifications = new NotificationsRouter(client)
		this.projects = new ProjectsRouter(client)
		this.revisions = new RevisionsRouter(client)
		this.workspace = new WorkspaceRouter(client)
	}
}
