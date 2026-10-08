import { nullDetector } from "@exagram/redactor"

import type { WorkerEdition } from "./edition.port"
import type { Env } from "./env"

// Takes the env like the full root, so the shared index.ts call compiles in both trees.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter keeps the signature of the full root
export const createWorkerEdition = (_env: Env): WorkerEdition => ({
	detector: nullDetector,
	createQueues: async () => {},
	register: async () => {},
})
