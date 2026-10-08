import { PersonalRuleError } from "./errors"

import type { WorkspaceKind } from "../entity/workspace"

const PERSONAL_RULE_SQLSTATE = "EXP01"

export const personalHas = (feature: string): string => `A Personal Workspace has no ${feature}.`

export function assertTeam(workspace: { kind: WorkspaceKind }, feature: string): void {
	if (workspace.kind === "personal") throw new PersonalRuleError(personalHas(feature))
}

export const asPersonalRuleError = (error: unknown): PersonalRuleError | null =>
	error instanceof Error && (error as { code?: unknown }).code === PERSONAL_RULE_SQLSTATE
		? new PersonalRuleError(error.message, { cause: error })
		: null
