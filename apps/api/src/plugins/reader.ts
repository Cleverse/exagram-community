import { anonymousReader, type LedgeredPrincipal } from "@exagram/core/entity/principal"
import { RateLimitedError } from "@exagram/core/utils/errors"
import { os } from "@orpc/server"

import type { BaseContext, SessionUser } from "./context"
import type { RateCounter } from "../mcp/rate"

/**
 * Who a read of `artifactId` is judged and ledgered as: the session's user, or with no session the
 * anonymous reader of that Artifact (ADR 0042). Only the three procedures a signed-out reader may call
 * use it; every other procedure keeps `requireUser`.
 */
export const readerOf = (user: SessionUser | null | undefined, artifactId: string): LedgeredPrincipal =>
	user ? { kind: "user", id: user.id, workspaceId: user.workspaceId } : anonymousReader(artifactId)

/**
 * One budget per IP across the three signed-out procedures. A page open spends two or three calls, and a
 * NAT shares one address among many people, so the budget is well above one person's reading pace.
 */
export const SIGNED_OUT_READS_PER_MINUTE = 120

/**
 * Takes one signed-out read from the IP's budget before the handler sees the Artifact, so a refused
 * burst tells a probed address nothing: an existing id and a missing one cost the same. A session
 * passes through; its calls are ledgered under its person.
 */
export const limitSignedOutReads = (rate: RateCounter) =>
	os.$context<BaseContext>().middleware(async ({ context, next }) => {
		if (!context.user && !rate.take(context.ip)) {
			throw new RateLimitedError(`Signed-out reads are limited to ${rate.perMinute} per minute.`)
		}
		return next()
	})
