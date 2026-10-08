/**
 * Prints the `/v1` OpenAPI document from the contract, without starting the server. The iOS client
 * commits a snapshot of it (`apps/ios/ExagramKit/openapi.json`); rerun this after a contract change:
 *
 *   pnpm --filter @exagram/api exec node --import tsx scripts/openapi-spec.ts > ../ios/ExagramKit/openapi.json
 */
import { coreContract } from "@exagram/core/contract"
import { OpenAPIGenerator } from "@orpc/openapi"
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4"

const generator = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] })
const spec = await generator.generate(coreContract, {
	info: { title: "Exagram API", version: "1.0.0" },
	servers: [{ url: "/v1" }],
})
process.stdout.write(`${JSON.stringify(spec, null, "\t")}\n`)
