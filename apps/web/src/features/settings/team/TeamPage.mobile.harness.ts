import { type AdminGroup, type GroupList, type MemberList, type WorkspaceInvite } from "@exagram/api-client"
import { screen } from "@testing-library/react"
import { createElement } from "react"
import { vi } from "vitest"

import TeamPageMobile from "./TeamPage.mobile"

import { type SheetLoader } from "@/components/mobile/sheet/registry"
import { type SheetKind } from "@/components/mobile/sheet/types"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ME, preloadSheet, recordingSheets, renderMobile } from "@/test/mobile"

const HOUR = 3_600_000
const iso = (msAgo: number) => new Date(Date.now() - msAgo)
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
export const OWNER = id(10)
export const GRACE = id(11)
export const LIN = id(12)

export const member = (userId: string, name: string, over: Partial<MemberList["items"][number]> = {}) => ({
	id: userId,
	name,
	email: `${name.split(" ")[0]?.toLowerCase()}@acme.test`,
	role: "member" as const,
	workspaceOwner: false,
	joinedAt: iso(30 * 24 * HOUR),
	lastActiveAt: iso(2 * HOUR),
	projectCount: 0,
	connectionCount: 0,
	...over,
})

export const ADMIN_LIST: MemberList = {
	view: "admin",
	items: [
		member(OWNER, "Olivia Owner", { role: "admin", workspaceOwner: true, projectCount: 4, connectionCount: 1 }),
		member(ME.id, "Ada Lovelace", { role: "admin", connectionCount: 2 }),
		member(GRACE, "Grace Hopper", { lastActiveAt: iso(26 * HOUR) }),
		member(LIN, "Lin Folder", { projectCount: 2, lastActiveAt: null }),
	],
}

export const MEMBER_LIST: MemberList = {
	view: "member",
	items: ADMIN_LIST.items.map(({ id: userId, name, email, role, workspaceOwner, joinedAt }) => ({
		id: userId,
		name,
		email,
		role,
		workspaceOwner,
		joinedAt,
	})),
}

export const INVITE: WorkspaceInvite = {
	id: id(50),
	email: "pending@acme.test",
	role: "member",
	via: "admin_invite",
	invitedByName: "Ada",
	createdAt: iso(3 * 24 * HOUR),
	expiresAt: iso(-4 * 24 * HOUR),
}

export const DESIGN: AdminGroup = { id: id(100), name: "Design team", memberCount: 2, memberIds: [GRACE, LIN] }
export const adminGroups = (...items: AdminGroup[]): GroupList => ({ view: "admin", items })

export const TEAM_SHEETS: Partial<Record<SheetKind, SheetLoader>> = {
	teamInvite: () => import("./sheets/teamInvite.sheet.mobile"),
	memberRole: () => import("./sheets/memberRole.sheet.mobile"),
	memberRemove: () => import("./sheets/memberRemove.sheet.mobile"),
	memberDemote: () => import("./sheets/memberDemote.sheet.mobile"),
	groupNew: () => import("./sheets/groupNew.sheet.mobile"),
	groupEdit: () => import("./sheets/groupEdit.sheet.mobile"),
	groupDelete: () => import("./sheets/groupDelete.sheet.mobile"),
}

export const renderTeam = async (): Promise<ReturnType<typeof renderMobile>> => {
	const sheets = recordingSheets()
	for (const [kind, load] of Object.entries(TEAM_SHEETS) as [SheetKind, SheetLoader][]) {
		sheets.set(kind, load)
		await preloadSheet(load)
	}
	return renderMobile(createElement(TeamPageMobile), {
		sheets,
		seed: (client) => client.setQueryData(QueryKeys.auth.me(), { ...ME, workspaceName: "Acme" }),
	})
}

export const drawer = (name: string) => screen.findByRole("dialog", { name })
const answerRefetchesAfterPeopleChange = () => {
	vi.spyOn(apiClient.auth, "me").mockResolvedValue({ ...ME, workspaceName: "Acme" } as never)
	vi.spyOn(apiClient.projects, "list").mockResolvedValue([])
	vi.spyOn(apiClient.artifacts, "list").mockResolvedValue([])
}

/** The spies every mobile Team case shares, whichever edition it asserts. */
export const stubTeamApi = () => {
	vi.spyOn(apiClient.workspace, "listMembers").mockResolvedValue(ADMIN_LIST)
	vi.spyOn(apiClient.workspace, "listInvites").mockResolvedValue({ items: [INVITE], passwordReset: false })
	vi.spyOn(apiClient.groups, "list").mockResolvedValue(adminGroups())
	answerRefetchesAfterPeopleChange()
}
