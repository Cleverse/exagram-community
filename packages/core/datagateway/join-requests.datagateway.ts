import type { JoinRequestCredential, JoinWait, NewJoinRequest } from "../entity/join-request"

export interface JoinRequestsDatagateway {
	openKeepingCredential(input: NewJoinRequest): Promise<JoinRequestCredential | null>
	waitIn(workspaceId: string, email: string): Promise<JoinWait | null>
	listOpenCredentials(email: string): Promise<JoinRequestCredential[]>
	deleteForEmail(email: string): Promise<void>
}
