import { z } from "zod"

/** Compose renders an unset `${X}` as "", so "" has to mean unset for every optional or defaulted key. */
export const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
	z.preprocess((value) => (value === "" ? undefined : value), schema)

/** A signing secret: 32+ characters, and not the `replace-with-…` placeholder the example env files ship. */
export const secretEnv = (name: string) =>
	z
		.string()
		.min(32)
		.refine((value) => !value.startsWith("replace-with"), {
			message: `${name} is still the example placeholder; run deploy/gen-secrets.sh to generate a real one`,
		})
