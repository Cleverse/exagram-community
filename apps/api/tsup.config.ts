import base from "@exagram/dotrc/tsup/node.ts"
import { defineConfig, type Options } from "tsup"

// preflight.js runs as the one-shot `preflight` service in deploy/compose.yml, on the same image.
// cli.js is the operator's commands: `docker compose exec api node dist/cli.js reset-link <email>`.
export default defineConfig({ ...(base as Options), entry: ["src/index.ts", "src/preflight.ts", "src/cli.ts"] })
