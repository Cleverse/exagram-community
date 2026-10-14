import { isIP } from "node:net"

import type { FastifyRequest } from "fastify"

/**
 * The client address the per-IP rate limiters key on. `header` is the one header the edge proxy
 * overwrites (`ENV.CLIENT_IP_HEADER`); everything else a caller sends, `X-Forwarded-For` included,
 * is ignored. A missing, duplicated (Node joins repeats with ", ") or non-IP value falls back to
 * the TCP peer.
 */
export const clientIp = (request: FastifyRequest, header: string | null): string => {
	if (header === null) return request.ip
	const value = request.headers[header]
	if (typeof value !== "string") return request.ip
	const candidate = value.trim()
	return isIP(candidate) === 0 ? request.ip : candidate
}
