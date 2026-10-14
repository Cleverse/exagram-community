import { NOTIFICATIONS_LIMIT } from "@exagram/core/contract/notifications/type"
import { BadRequestError } from "@exagram/core/utils/errors"
import { describe, expect, it, vi } from "vitest"

import type { NotificationRow, NotificationsDatagateway } from "@exagram/core/datagateway/notifications.datagateway"
import type { NotificationPreferences } from "@exagram/core/entity/notification"

import { DEFAULT_PREFERENCES, NotificationsUsecase } from "./notifications.usecase"

const USER = "11111111-1111-4111-8111-111111111111"
const WORKSPACE = "44444444-4444-4444-8444-444444444444"
const ACTING = { id: USER, workspaceId: WORKSPACE }
const DB_NOW = new Date("2026-10-06T12:00:00Z")
const DAY = 24 * 60 * 60 * 1000

const row = (n: number): NotificationRow => ({
	id: `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`,
	kind: "comment",
	artifactId: "33333333-3333-4333-8333-333333333333",
	projectId: null,
	title: "Plan",
	actorName: "Bo",
	revision: null,
	role: null,
	outcome: null,
	subject: null,
	note: null,
	createdAt: new Date("2026-10-06T11:00:00.123Z"),
	cursorAt: "2026-10-06T11:00:00.123456Z",
})

const repo = (rows: NotificationRow[] = [row(1)], saved: NotificationPreferences | null = null) => ({
	listSince: vi.fn<NotificationsDatagateway["listSince"]>().mockResolvedValue(rows),
	now: vi.fn<NotificationsDatagateway["now"]>().mockResolvedValue(DB_NOW),
	getPreferences: vi.fn<NotificationsDatagateway["getPreferences"]>().mockResolvedValue(saved),
	setPreferences: vi
		.fn<NotificationsDatagateway["setPreferences"]>()
		.mockImplementation((_userId, _workspaceId, preferences) => Promise.resolve(preferences)),
})

describe("NotificationsUsecase.list", () => {
	it("answers a first call with no items, the database's clock and no next page", async () => {
		const notifications = repo()
		await expect(new NotificationsUsecase(notifications).list(ACTING, {})).resolves.toEqual({
			items: [],
			serverTime: DB_NOW,
			next: null,
		})
		expect(notifications.listSince).not.toHaveBeenCalled()
	})

	it("lists from `since`, capped at NOTIFICATIONS_LIMIT, without the row's cursor, and no next on a partial page", async () => {
		const notifications = repo()
		const since = new Date("2026-10-06T10:00:00Z")
		const result = await new NotificationsUsecase(notifications).list(ACTING, { since })
		expect(result.items[0]).not.toHaveProperty("cursorAt")
		expect(result).toEqual({
			items: [{ ...row(1), cursorAt: undefined }],
			serverTime: DB_NOW,
			next: null,
		})
		expect(notifications.listSince).toHaveBeenCalledWith(
			USER,
			{ notBefore: since, after: null, workspaceId: WORKSPACE },
			NOTIFICATIONS_LIMIT,
		)
	})

	it("treats a `since` older than 7 days as 7 days before the database's clock", async () => {
		const notifications = repo()
		await new NotificationsUsecase(notifications).list(ACTING, { since: new Date(0) })
		expect(notifications.listSince).toHaveBeenCalledWith(
			USER,
			{ notBefore: new Date(DB_NOW.getTime() - 7 * DAY), after: null, workspaceId: WORKSPACE },
			NOTIFICATIONS_LIMIT,
		)
	})

	it("hands out `next` on a full page, and reads on from exactly that row when it comes back", async () => {
		const page = Array.from({ length: NOTIFICATIONS_LIMIT }, (_, i) => row(i + 1))
		const notifications = repo(page)
		const usecase = new NotificationsUsecase(notifications)
		const first = await usecase.list(ACTING, { since: new Date("2026-10-06T10:00:00Z") })
		expect(first.next).not.toBeNull()

		await usecase.list(ACTING, { since: new Date(0), after: first.next! })
		expect(notifications.listSince).toHaveBeenLastCalledWith(
			USER,
			{
				notBefore: new Date("2026-10-06T11:00:00.123Z"),
				after: { at: "2026-10-06T11:00:00.123456Z", id: page.at(-1)!.id },
				workspaceId: WORKSPACE,
			},
			NOTIFICATIONS_LIMIT,
		)
	})

	it("refuses an `after` the server never gave out", async () => {
		const usecase = new NotificationsUsecase(repo())
		for (const after of ["nope", Buffer.from("2026-10-06T11:00:00Z|x").toString("base64url"), "||"]) {
			await expect(usecase.list(ACTING, { after })).rejects.toBeInstanceOf(BadRequestError)
		}
	})
})

describe("NotificationsUsecase preferences", () => {
	it("gives a member who never saved the defaults: every kind on but the recap, member scope, quiet hours on", async () => {
		await expect(new NotificationsUsecase(repo([], null)).getPreferences(ACTING)).resolves.toEqual({
			accessRequests: true,
			pendingRevisions: true,
			grants: true,
			comments: true,
			decisions: true,
			published: true,
			connections: true,
			recap: false,
			revisionScope: "member",
			mutedProjectIds: [],
			quietHours: { enabled: true, from: "22:00", to: "08:00", urgent: true },
		})
	})

	it("returns saved preferences as they are", async () => {
		const saved: NotificationPreferences = { ...DEFAULT_PREFERENCES, accessRequests: false, revisionScope: "all" }
		const notifications = repo([], saved)
		await expect(new NotificationsUsecase(notifications).getPreferences(ACTING)).resolves.toEqual(saved)
		expect(notifications.getPreferences).toHaveBeenCalledWith(USER, WORKSPACE)
	})

	it("replaces the whole object", async () => {
		const saved: NotificationPreferences = { ...DEFAULT_PREFERENCES, recap: true }
		const notifications = repo([], saved)
		const next: NotificationPreferences = {
			...DEFAULT_PREFERENCES,
			pendingRevisions: false,
			published: false,
			revisionScope: "mine",
			mutedProjectIds: ["33333333-3333-4333-8333-333333333333"],
			quietHours: { enabled: false, from: "21:00", to: "07:00", urgent: false },
		}
		await expect(new NotificationsUsecase(notifications).setPreferences(ACTING, next)).resolves.toEqual(next)
		expect(notifications.setPreferences).toHaveBeenCalledWith(USER, WORKSPACE, next)
	})

	it("keeps the saved value of each field an older client with only the first four switches leaves out", async () => {
		const saved: NotificationPreferences = {
			...DEFAULT_PREFERENCES,
			published: false,
			revisionScope: "all",
			mutedProjectIds: ["33333333-3333-4333-8333-333333333333"],
		}
		const notifications = repo([], saved)
		const four = { accessRequests: false, pendingRevisions: true, grants: false, comments: true }
		await new NotificationsUsecase(notifications).setPreferences(ACTING, { ...four, recap: undefined })
		expect(notifications.setPreferences).toHaveBeenCalledWith(USER, WORKSPACE, { ...saved, ...four })
	})
})
