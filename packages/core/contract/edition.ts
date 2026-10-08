import { accessRequestsContract } from "./access-requests/contract"
import { approvalsContract } from "./approvals/contract"
import { artifactsContract } from "./artifacts/contract"
import { authContract } from "./auth/contract"
import { commentsContract } from "./comments/contract"
import { connectionsContract } from "./connections/contract"
import { eventsContract } from "./events/contract"
import { grantsContract } from "./grants/contract"
import { ledgerContract } from "./ledger/contract"
import { linksContract } from "./links/contract"
import { notificationsContract } from "./notifications/contract"
import { projectsContract } from "./projects/contract"
import { revisionsContract } from "./revisions/contract"
import { workspaceContract } from "./workspace/contract"

export const coreContract = {
	auth: authContract,
	projects: projectsContract,
	artifacts: artifactsContract,
	revisions: revisionsContract,
	approvals: approvalsContract,
	grants: grantsContract,
	accessRequests: accessRequestsContract,
	comments: commentsContract,
	links: linksContract,
	ledger: ledgerContract,
	connections: connectionsContract,
	workspace: workspaceContract,
	events: eventsContract,
	notifications: notificationsContract,
}
