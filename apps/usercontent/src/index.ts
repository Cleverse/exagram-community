import { createPool } from "@exagram/core/repository/postgres/db"
import { resolveDbEnv } from "@exagram/core/repository/postgres/db.env"
import { createObjectStore } from "@exagram/core/services/storage/storage.factory"
import { createLifecycle } from "@exagram/core/utils/lifecycle"

import { buildUsercontentApp } from "./app"
import { ENV } from "./env"

const db = resolveDbEnv(ENV)
const sql = createPool({ url: db.url, ssl: db.ssl, max: db.max, onNotice: console.log })

const app = buildUsercontentApp({
	sql,
	secret: ENV.USERCONTENT_TOKEN_SECRET,
	objectStore: await createObjectStore(ENV),
	frameAncestors: ENV.USERCONTENT_FRAME_ANCESTORS,
	usercontentOrigin: ENV.USERCONTENT_ORIGIN,
	logLevel: ENV.LOG_LEVEL,
	isReady: () => lifecycle.isReady(),
})

const lifecycle = createLifecycle({
	timeoutSec: ENV.SHUTDOWN_TIMEOUT_SEC,
	close: async () => {
		await app.close()
		await sql.end()
	},
	exit: (code) => process.exit(code),
	log: (event, extra) => app.log.error(extra ?? {}, event),
})

lifecycle.install(process)

await app.listen({ port: ENV.HTTP_PORT, host: "0.0.0.0" })
