import { DomainError } from "@exagram/core/utils/errors"
import { asPersonalRuleError } from "@exagram/core/utils/personal-rule"
import { ORPCError } from "@orpc/server"

export function toClientError(error: unknown): ORPCError<string, unknown> {
	const domain = asPersonalRuleError(error) ?? error
	if (domain instanceof DomainError) {
		return new ORPCError(domain.code, { status: domain.statusCode, message: domain.message, cause: domain })
	}
	if (error instanceof ORPCError) return error as ORPCError<string, unknown>
	return new ORPCError("INTERNAL_SERVER_ERROR", { cause: error })
}
