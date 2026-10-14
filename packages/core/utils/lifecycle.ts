export interface LifecycleDeps {
	timeoutSec: number
	close: () => Promise<void>
	exit: (code: number) => void
	log: (event: string, extra?: Record<string, unknown>) => void
}

export interface Lifecycle {
	isReady: () => boolean
	shutdown: () => void
	/** Wires SIGTERM and SIGINT on the given process to `shutdown`. */
	install: (proc: NodeJS.Process) => void
}

/**
 * A drain lifecycle shared by every server app: readiness flips to false the instant a shutdown
 * signal arrives, `close` gets `timeoutSec` to finish, and a hang forces the process down anyway so
 * an orchestrator's terminationGracePeriod is never exceeded.
 */
export function createLifecycle(deps: LifecycleDeps): Lifecycle {
	let ready = true
	let shuttingDown = false

	const shutdown = (): void => {
		if (shuttingDown) return
		shuttingDown = true
		ready = false

		let settled = false
		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			deps.log("lifecycle:shutdown-timeout")
			deps.exit(1)
		}, deps.timeoutSec * 1000)

		deps.close().then(
			() => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				deps.exit(0)
			},
			(error: unknown) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				deps.log("lifecycle:shutdown-error", { error })
				deps.exit(1)
			},
		)
	}

	return {
		isReady: () => ready,
		shutdown,
		install: (proc) => {
			for (const signal of ["SIGTERM", "SIGINT"] as const) {
				proc.on(signal, shutdown)
			}
		},
	}
}
