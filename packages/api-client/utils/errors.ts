export class ApiError extends Error {
	readonly isApiError = true

	constructor(
		readonly status: number,
		message: string,
		readonly code?: string,
	) {
		super(message)
		this.name = "ApiError"
	}
}

export const isApiError = (error: unknown): error is ApiError =>
	error !== null && typeof error === "object" && "isApiError" in error

const isOrpcError = (error: unknown): error is Error & { status: number; code?: string } =>
	error instanceof Error && "status" in error && typeof (error as { status: unknown }).status === "number"

export const codeOf = (error: unknown): string | undefined => (isOrpcError(error) ? error.code : undefined)

export const statusOf = (error: unknown): number => (isOrpcError(error) ? error.status : 500)

export const PERSONAL_RULE = "PERSONAL_RULE"

const isPersonalRuleSentence = (error: unknown): error is Error =>
	isOrpcError(error) && error.code === PERSONAL_RULE && error.status === 400

/**
 * A withheld Artifact and a nonexistent id both arrive as 404 and must stay indistinguishable, so
 * callers get one status and one message; typed non-refusal codes remain available for branching.
 */
export const failWith = (error: unknown, message: string): never => {
	const said = isPersonalRuleSentence(error) ? error.message : message
	throw new ApiError(statusOf(error), said, codeOf(error))
}

const USER_FACING_STATUSES = new Set([400, 409, 429])

/**
 * For an action whose 400, 409 and 429 messages are written for the person (a password rule, "already a
 * member", a rate limit): those come through. A 404 refusal and anything else keep `fallback`.
 */
export const failWithUserMessage = (error: unknown, fallback: string): never =>
	failWith(error, USER_FACING_STATUSES.has(statusOf(error)) && error instanceof Error ? error.message : fallback)

/** Which gate an Artifact read stopped at (ADR 0044): the two answers that, unlike a refusal, say what to do next. */
export type AnyoneGate = "password" | "expired"

const GATE_OF_CODE: Record<string, AnyoneGate> = { PASSWORD_REQUIRED: "password", ANYONE_EXPIRED: "expired" }

export const anyoneGateOf = (error: unknown): AnyoneGate | null => GATE_OF_CODE[codeOf(error) ?? ""] ?? null

export const isIncorrectPassword = (error: unknown): boolean => codeOf(error) === "INCORRECT_PASSWORD"
