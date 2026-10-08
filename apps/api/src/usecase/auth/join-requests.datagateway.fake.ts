import type { JoinRequestsDatagateway } from "@exagram/core/datagateway/join-requests.datagateway"
import type { JoinRequestCredential, JoinWait, NewJoinRequest } from "@exagram/core/entity/join-request"

import { FakeJoiningDatagateway } from "../workspace/joining.datagateway.fake"

import type { JoinGateways } from "./auth.usecase"

interface FakeJoinRequest extends NewJoinRequest {
	id: string
	createdAt: Date
	declinedAt: Date | null
}

/* eslint-disable @typescript-eslint/require-await -- an in-memory double for a Promise-returning port */
export class FakeJoinRequests implements JoinRequestsDatagateway {
	readonly rows: FakeJoinRequest[] = []
	private seq = 0

	async openKeepingCredential(input: NewJoinRequest): Promise<JoinRequestCredential | null> {
		const existing = this.rows.find((row) => row.workspaceId === input.workspaceId && this.sameEmail(row, input.email))
		if (existing && existing.declinedAt === null) {
			const sameKind = (existing.passwordHash === null) === (input.passwordHash === null)
			if (!sameKind || existing.googleSubject !== input.googleSubject) return null
			Object.assign(existing, { name: input.name, via: input.via, invitedBy: input.invitedBy })
			return { passwordHash: existing.passwordHash }
		}
		if (existing) {
			Object.assign(existing, { ...input, declinedAt: null })
			return { passwordHash: existing.passwordHash }
		}
		this.seq += 1
		this.rows.push({
			...input,
			id: `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`,
			createdAt: new Date(Date.now() + this.seq),
			declinedAt: null,
		})
		return { passwordHash: input.passwordHash }
	}

	async waitIn(workspaceId: string, email: string): Promise<JoinWait | null> {
		const row = this.rows.find((item) => item.workspaceId === workspaceId && this.sameEmail(item, email))
		if (!row) return null
		return row.declinedAt === null ? "pending" : "declined"
	}

	async listOpenCredentials(email: string): Promise<JoinRequestCredential[]> {
		return this.rows
			.filter((row) => row.declinedAt === null && this.sameEmail(row, email))
			.map(({ passwordHash }) => ({ passwordHash }))
	}

	async deleteForEmail(email: string): Promise<void> {
		const kept = this.rows.filter((row) => !this.sameEmail(row, email))
		this.rows.splice(0, this.rows.length, ...kept)
	}

	private sameEmail(row: FakeJoinRequest, email: string): boolean {
		return row.email.toLowerCase() === email.toLowerCase()
	}
}

export const fakeJoins = (): JoinGateways & { joining: FakeJoiningDatagateway; requests: FakeJoinRequests } => ({
	joining: new FakeJoiningDatagateway(() => 0, { anyWorkspace: true }),
	requests: new FakeJoinRequests(),
})
