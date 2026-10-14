declare module "vitest" {
	export interface ProvidedContext {
		/** One migrated database per vitest worker, indexed by VITEST_POOL_ID - 1; read it through `pgUrl()`. */
		pgWorkerUrls: string[]
	}
}

export {}
