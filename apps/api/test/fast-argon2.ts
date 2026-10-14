import { vi } from "vitest"

import type argon2 from "argon2"

/**
 * Production-cost argon2 (~25 ms a call, several hundred calls) was the largest single cost of the
 * auth suites. Tests hash at the minimum cost instead; `verify` reads the cost from the hash, so it
 * follows. `verifyDummy` checks a fixed production-cost hash and stays as slow as in production.
 */
vi.mock("argon2", async (importOriginal) => {
	const real = (await importOriginal<{ default: typeof argon2 }>()).default
	const cheap = {
		...real,
		hash: (plain: string, options?: Parameters<typeof real.hash>[1]) =>
			real.hash(plain, { ...options, memoryCost: 8, timeCost: 1, parallelism: 1 }),
	}
	return { ...cheap, default: cheap }
})
