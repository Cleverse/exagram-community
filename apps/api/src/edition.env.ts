// Not `z.infer`: zod infers `Record<string, never>` for an empty object, which rejects every key of the `Env` it joins.
export type EditionEnv = Record<never, never>

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter documents the shared call shape
export const parseEditionEnv = (_source: Record<string, string | undefined>): EditionEnv => ({})

/** Community always allows an Admin's Reset Link. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter documents the shared call shape
export const adminPasswordReset = (_env: object): boolean => true
