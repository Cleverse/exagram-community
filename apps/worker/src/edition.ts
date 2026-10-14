import { nullDetector } from "@exagram/redactor"

import type { WorkerEdition } from "./edition.port"
import type { Env } from "./env"

// Needs no extra wiring; it takes the env because the shared index.ts passes it to every edition root.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter keeps the shared signature
export const createWorkerEdition = (_env: Env): WorkerEdition => ({
	detector: nullDetector,
	createQueues: async () => {},
	register: async () => {},
})
