export type DomainErrorCode =
	| "BAD_REQUEST"
	| "PERSONAL_RULE"
	| "PLACEHOLDERS_NEED_CONFIRMATION"
	| "REDACTION_NOT_READY"
	| "UNAUTHORIZED"
	| "FORBIDDEN"
	| "JOIN_PENDING"
	| "JOIN_DECLINED"
	| "PASSWORD_REQUIRED"
	| "INCORRECT_PASSWORD"
	| "ANYONE_EXPIRED"
	| "NOT_FOUND"
	| "CONFLICT"
	| "SEATS_FULL"
	| "TRANSFER_REQUIRED"
	| "TOO_MANY_REQUESTS"
	| "SERVICE_UNAVAILABLE"

const STATUS: Record<DomainErrorCode, number> = {
	BAD_REQUEST: 400,
	PERSONAL_RULE: 400,
	PLACEHOLDERS_NEED_CONFIRMATION: 400,
	REDACTION_NOT_READY: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	JOIN_PENDING: 403,
	JOIN_DECLINED: 403,
	// Not 401: the iOS client ends the session on any 401, and these meet a signed-in reader too.
	PASSWORD_REQUIRED: 403,
	INCORRECT_PASSWORD: 403,
	ANYONE_EXPIRED: 410,
	NOT_FOUND: 404,
	CONFLICT: 409,
	SEATS_FULL: 409,
	TRANSFER_REQUIRED: 409,
	TOO_MANY_REQUESTS: 429,
	SERVICE_UNAVAILABLE: 503,
}

export class DomainError extends Error {
	readonly code: DomainErrorCode
	readonly statusCode: number

	constructor(code: DomainErrorCode, message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = code
		this.code = code
		this.statusCode = STATUS[code]
	}
}

export class BadRequestError extends DomainError {
	constructor(message: string, code: DomainErrorCode = "BAD_REQUEST") {
		super(code, message)
	}
}

export class PlaceholdersNeedConfirmationError extends BadRequestError {
	constructor(message: string) {
		super(message, "PLACEHOLDERS_NEED_CONFIRMATION")
	}
}

export class PersonalRuleError extends DomainError {
	constructor(message: string, options?: ErrorOptions) {
		super("PERSONAL_RULE", message, options)
	}
}

export class RedactionNotReadyError extends BadRequestError {
	constructor(message: string) {
		super(message, "REDACTION_NOT_READY")
	}
}
export class UnauthorizedError extends DomainError {
	constructor(message: string) {
		super("UNAUTHORIZED", message)
	}
}
export class ForbiddenError extends DomainError {
	constructor(message: string) {
		super("FORBIDDEN", message)
	}
}
export class NotFoundError extends DomainError {
	constructor(message: string) {
		super("NOT_FOUND", message)
	}
}
export class ConflictError extends DomainError {
	constructor(message: string) {
		super("CONFLICT", message)
	}
}
export class SeatsFullError extends DomainError {
	constructor() {
		super("SEATS_FULL", "No seats left. Revoke an invite or ask for more seats.")
	}
}
export class TransferRequiredError extends DomainError {
	constructor() {
		super("TRANSFER_REQUIRED", "Choose who takes over what they own.")
	}
}
export class JoinPendingError extends DomainError {
	constructor() {
		super("JOIN_PENDING", "Waiting for an admin to approve you.")
	}
}
export class JoinDeclinedError extends DomainError {
	constructor() {
		super("JOIN_DECLINED", "An Admin declined your request to join. Ask an Admin to invite you.")
	}
}
/**
 * The first of two answers that break refusal parity on purpose (ADR 0044): a reader the General Access
 * password stopped is told so, and learns nothing else about the Artifact.
 */
export class PasswordRequiredError extends DomainError {
	constructor() {
		super("PASSWORD_REQUIRED", "Enter the password to open this file.")
	}
}
/** The second: an expired address says it existed. */
export class AnyoneExpiredError extends DomainError {
	constructor() {
		super("ANYONE_EXPIRED", "This link has expired. Ask the owner for a new one.")
	}
}
export class IncorrectPasswordError extends DomainError {
	constructor() {
		super("INCORRECT_PASSWORD", "Incorrect password. Try again.")
	}
}
export class RateLimitedError extends DomainError {
	constructor(message: string) {
		super("TOO_MANY_REQUESTS", message)
	}
}
export class ServiceUnavailableError extends DomainError {
	constructor(message: string) {
		super("SERVICE_UNAVAILABLE", message)
	}
}
/** This install runs without a model key, so AI edit is switched off. */
export class AiEditUnavailableError extends ServiceUnavailableError {
	constructor() {
		super("AI edits are off on this install.")
	}
}
