import { z } from "zod"

export const ConnectionSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	oidcClientId: z.string(),
	scopes: z.array(z.enum(["read", "write", "manage"])),
	folderAccess: z.enum(["all", "named"]),
	folderCount: z.number().int().nonnegative(),
	workspaceId: z.uuid(),
	revokedAt: z.date().nullable(),
	createdAt: z.date(),
})
export type Connection = z.infer<typeof ConnectionSchema>

export const ListConnectionsQuerySchema = z.object({
	workspace: z.enum(["current", "all"]).default("current"),
})

const ConnectionFolderSchema = z.object({
	projectId: z.uuid(),
	access: z.enum(["view", "edit"]),
})

const ConnectionProjectSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	parentProjectId: z.uuid().nullable(),
	ownerName: z.string(),
	personAccess: z.enum(["owner", "edit", "collaborate", "view"]),
})

export const ConnectionFoldersSchema = z.object({
	access: z.enum(["all", "named"]),
	otherFilesAccess: z.enum(["none", "view"]),
	folders: z.array(ConnectionFolderSchema),
	projects: z.array(ConnectionProjectSchema),
})
export type ConnectionFolders = z.infer<typeof ConnectionFoldersSchema>
