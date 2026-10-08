import type { SignUpWorkspaceInput } from "@/edition/edition.port"

/** The sign-up request. With no Workspace fields (Community), no Workspace key is sent. */
export const signUpBody = (
	account: { email: string; name: string; password: string },
	workspace: SignUpWorkspaceInput | null,
) => ({ ...account, ...workspace })
