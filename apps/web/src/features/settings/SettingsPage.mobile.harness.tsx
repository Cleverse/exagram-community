import {
	COMMUNITY_CAPABILITIES,
	type Connection,
	type NotificationPreferences,
	type WorkspaceKind,
} from "@exagram/api-client"
import { vi } from "vitest"

import SettingsPageMobile from "./SettingsPage.mobile"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { edition as community } from "@/edition/edition"
import { ME, renderMobile } from "@/test/mobile"

export const me = {
	...ME,
	workspaceId: "ws-0001",
	isAdmin: true,
	googleLinked: false,
	createdAt: new Date(2026, 0, 1),
}

export const connection = (over: Partial<Connection> = {}): Connection => ({
	id: "settings-conn-1",
	workspaceId: "workspace-1",
	name: "Claude Desktop",
	oidcClientId: "client-1",
	scopes: ["read"],
	folderAccess: "all",
	folderCount: 0,
	revokedAt: null,
	createdAt: new Date(2026, 7, 12),
	...over,
})

/** `redaction` is the Workspace's redaction state; its `enabled` decides the tab list in Cloud. */
export const renderSettings = (
	tab: string,
	{
		redaction = { redaction: "on" as const, canChange: true, enabled: true },
		connections = [connection()],
		isAdmin = true,
		workspaceKind,
	}: {
		redaction?: { redaction: "on" | "off"; canChange: boolean; enabled: boolean }
		connections?: Connection[]
		isAdmin?: boolean
		workspaceKind?: WorkspaceKind
	} = {},
): ReturnType<typeof renderMobile> =>
	renderMobile(<SettingsPageMobile />, {
		path: "/settings/:tab",
		at: `/settings/${tab}`,
		seed: (client) => {
			client.setQueryData(QueryKeys.auth.me(), { ...me, isAdmin, ...(workspaceKind && { workspaceKind }) })
			client.setQueryData(QueryKeys.auth.providers(), {
				google: true,
				signUp: true,
				aiEdit: true,
				edition: "cloud",
				capabilities: { ...COMMUNITY_CAPABILITIES, aiEdit: true, redaction: redaction.enabled },
			})
			client.setQueryData(QueryKeys.redaction.workspace(), redaction)
			client.setQueryData(QueryKeys.connections.list(), connections)
		},
	})

/** The Notification Preferences ADR 0040 added, at their defaults; this tab does not show them yet. */
export const LATER_PREFERENCES: Omit<
	NotificationPreferences,
	"accessRequests" | "pendingRevisions" | "grants" | "comments"
> = {
	decisions: true,
	published: true,
	connections: true,
	recap: false,
	revisionScope: "member",
	mutedProjectIds: [],
	quietHours: { enabled: true, from: "22:00", to: "08:00", urgent: true },
}

export const MEMBERS = [
	{
		id: "00000000-0000-4000-8000-0000000000b1",
		name: "Ada Lovelace",
		email: "ada@example.com",
		role: "admin" as const,
		workspaceOwner: true,
		joinedAt: new Date(2026, 0, 1),
	},
	{
		id: "00000000-0000-4000-8000-0000000000b2",
		name: "Grace Hopper",
		email: "grace@example.com",
		role: "member" as const,
		workspaceOwner: false,
		joinedAt: new Date(2026, 1, 1),
	},
]

/** The spies every Settings case shares; the email spies belong to the ee cases. */
export const stubSettingsApi = () => {
	vi.spyOn(apiClient.workspace, "listMembers").mockResolvedValue({
		view: "admin",
		items: MEMBERS.map((member) => ({ ...member, lastActiveAt: null, projectCount: 0, connectionCount: 0 })),
	})
	vi.spyOn(apiClient.ledger, "activity").mockResolvedValue({ items: [], nextCursor: null })
	vi.spyOn(apiClient.workspace, "listInvites").mockResolvedValue({ items: [], passwordReset: false })
}

/** Core cases assert Community's Team page, whichever edition the lane builds. */
export const useCommunityTeam = () => {
	if ((edition as unknown) === community) return
	vi.spyOn(edition, "useTeamJoining").mockImplementation(() => community.useTeamJoining())
	vi.spyOn(edition, "useTeamRequests").mockImplementation((admin) => community.useTeamRequests(admin))
}
