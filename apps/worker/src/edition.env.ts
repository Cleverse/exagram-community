import { z } from "zod"

// Typed, not inferred: zod infers `Record<string, never>` for an empty object, which would reject every key of the
// `Env` it joins.
export const EditionEnvSchema: z.ZodType<Record<never, never>> = z.object({})
export type EditionEnv = Record<never, never>

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameters document the shared call shape
export const checkEditionEnv = (_env: unknown, _ctx: z.RefinementCtx): void => {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter documents the shared call shape
export const editionDefaults = (_env: unknown) => ({})
