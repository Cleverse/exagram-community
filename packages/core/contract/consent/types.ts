import { z } from "zod"

export const ConsentWorkspaceSchema = z.object({
	id: z.uuid(),
	kind: z.enum(["personal", "team"]),
	name: z.string(),
})

export const ConsentInfoSchema = z.object({
	uid: z.string(),
	clientName: z.string(),
	scopes: z.array(z.string()),
	resource: z.string(),
	hasNamedFolderAccess: z.boolean(),
	defaultWorkspaceId: z.uuid(),
	currentConnectionWorkspaceId: z.uuid().nullable(),
	workspaces: z.array(ConsentWorkspaceSchema),
})

export const ApproveConsentBodySchema = z.object({
	name: z.string().min(1).max(100),
	scopes: z.array(z.string()).min(1),
	workspaceId: z.uuid().optional(),
})

/** The browser navigates to this; the API never writes a 303 of its own (see Step 4). */
export const ConsentRedirectSchema = z.object({ redirectTo: z.url() })
