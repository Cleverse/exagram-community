import { type WorkspaceKind } from "@exagram/api-client"

import { edition } from "@/edition/edition"

/**
 * Whether a folder has rules to show: the policy and overwrite switch this browser keeps, where the edition has
 * them, or a Team folder's Published version.
 */
export const hasProjectRules = (kind: WorkspaceKind) => edition.projectRules || kind !== "personal"
