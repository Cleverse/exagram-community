import type { User } from "@exagram/core/entity/auth"

export type Caller = Pick<User, "id" | "workspaceId">
