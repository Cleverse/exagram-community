import { BadRequestError } from "@exagram/core/utils/errors"
import { createRouterClient } from "@orpc/server"
import { describe, expect, it, vi } from "vitest"

import { DEFAULT_PREFERENCES, type NotificationsUsecase } from "../usecase/notifications.usecase"

import { createNotificationsRouter } from "./notifications.router"

import type { BaseContext } from "../plugins/context"

const user = {
	id: "11111111-1111-4111-8111-111111111111",
	workspaceId: "22222222-2222-4222-8222-222222222222",
	email: "me@example.com",
	name: "Me",
	isAdmin: false,
	createdAt: new Date(),
}

const clientFor = (usecase: Partial<NotificationsUsecase>) =>
	createRouterClient(createNotificationsRouter({ notificationsUsecase: usecase as NotificationsUsecase }), {
		context: {
			headers: {},
			ip: "203.0.113.7",
			requestId: "r1",
			user,
		} as unknown as BaseContext,
	})

describe("notifications router", () => {
	it("hands the caller and a parsed `since` to the usecase", async () => {
		const serverTime = new Date("2026-10-06T12:00:00Z")
		const list = vi.fn().mockResolvedValue({ items: [], serverTime, next: null })
		await expect(
			clientFor({ list }).list({ query: { since: "2026-10-06T10:00:00Z" as unknown as Date, after: "abc" } }),
		).resolves.toEqual({ result: { items: [], serverTime, next: null } })
		expect(list).toHaveBeenCalledWith(user, { since: new Date("2026-10-06T10:00:00Z"), after: "abc" })
	})

	it("passes no cursor on a device's first call", async () => {
		const list = vi.fn().mockResolvedValue({ items: [], serverTime: new Date(), next: null })
		await clientFor({ list }).list({ query: {} })
		expect(list).toHaveBeenCalledWith(user, {})
	})

	it("answers a bad cursor as a bad request", async () => {
		const list = vi.fn().mockRejectedValue(new BadRequestError("bad cursor"))
		await expect(clientFor({ list }).list({ query: { after: "x" } })).rejects.toMatchObject({ code: "BAD_REQUEST" })
	})

	it("accepts a body from an older client that sends only the first four switches, and refuses a malformed quiet hour", async () => {
		const setPreferences = vi.fn().mockResolvedValue(DEFAULT_PREFERENCES)
		const four = { accessRequests: true, pendingRevisions: true, grants: true, comments: true }
		await clientFor({ setPreferences }).setPreferences({ body: four })
		expect(setPreferences).toHaveBeenCalledWith(user, four)

		await expect(
			clientFor({ setPreferences }).setPreferences({
				body: { ...four, quietHours: { enabled: true, from: "25:00", to: "08:00", urgent: true } },
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
		await expect(
			clientFor({ setPreferences }).setPreferences({
				body: { ...four, revisionScope: "everyone" as unknown as "all" },
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
		expect(setPreferences).toHaveBeenCalledTimes(1)
	})

	it("replaces the caller's preferences with the body", async () => {
		const body = {
			accessRequests: false,
			pendingRevisions: true,
			grants: true,
			comments: false,
			decisions: true,
			published: false,
			connections: true,
			recap: true,
			revisionScope: "mine" as const,
			mutedProjectIds: ["33333333-3333-4333-8333-333333333333"],
			quietHours: { enabled: true, from: "22:30", to: "06:45", urgent: false },
		}
		const setPreferences = vi.fn().mockResolvedValue(body)
		await expect(clientFor({ setPreferences }).setPreferences({ body })).resolves.toEqual({ result: body })
		expect(setPreferences).toHaveBeenCalledWith(user, body)
	})
})
