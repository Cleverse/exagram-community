import type {
	JoinRequestCredential,
	JoinWait,
	NewAccountJoinRequest,
	NewJoinRequest,
	OpenedForAccount,
} from "../entity/join-request"

export interface JoinRequestsDatagateway {
	openKeepingCredential(input: NewJoinRequest): Promise<JoinRequestCredential | null>
	openForAccount(input: NewAccountJoinRequest): Promise<OpenedForAccount>
	waitIn(workspaceId: string, email: string): Promise<JoinWait | null>
	listOpenCredentialsWithoutAccount(email: string): Promise<JoinRequestCredential[]>
	deleteForAccount(userId: string): Promise<void>
}
