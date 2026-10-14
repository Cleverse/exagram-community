import type { LedgerDatagateway } from "../../datagateway/ledger.datagateway"
import type { CallStatus, LedgeredPrincipal, ServeOutcome, Surface, WithheldReason } from "../../entity/principal"

/**
 * The ledger is written by the read path, never beside it: every method here runs inside the caller's
 * `TransactionManager.atomic()`, so a rolled-back serve leaves no row claiming a read happened.
 */
export class LedgerService {
	constructor(private readonly ledger: LedgerDatagateway) {}

	openCall(input: {
		principal: LedgeredPrincipal
		surface: Surface
		action: string
		subject?: string
	}): Promise<string> {
		return this.ledger.startCall({
			principalKind: input.principal.kind,
			principalId: input.principal.id,
			workspaceId: "workspaceId" in input.principal ? input.principal.workspaceId : null,
			surface: input.surface,
			action: input.action,
			...(input.subject !== undefined ? { subject: input.subject } : {}),
		})
	}

	recordServe(input: {
		callId: string
		artifactId: string | null
		revisionId: string | null
		outcome: ServeOutcome
		reason: WithheldReason | null
		form: "original" | "redacted" | null
		detectorVersion: number | null
	}): Promise<void> {
		return this.ledger.recordServe(input)
	}

	/** `delivered` stamps the digest of what was served; `failed` records the refusal and carries no digest. */
	settle(input: {
		callId: string
		status: Exclude<CallStatus, "authorized">
		bodySha256: string | null
	}): Promise<void> {
		return input.status === "delivered"
			? this.ledger.markDelivered(input.callId, input.bodySha256)
			: this.ledger.markFailed(input.callId)
	}

	recordBodyDigest(callId: string, bodySha256: string): Promise<void> {
		return this.ledger.setBodyDigest(callId, bodySha256)
	}
}
