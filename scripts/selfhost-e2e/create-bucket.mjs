// Creates the e2e bucket on the throwaway S3-compatible store. Usage:
//   E2E_S3_ACCESS_KEY_ID=… E2E_S3_SECRET_ACCESS_KEY=… node create-bucket.mjs <endpoint> <bucket>
// Credentials come from the environment so they stay out of `ps`. The SDK is resolved from
// packages/core, which depends on it; the repo root does not.
import { createRequire } from "node:module"

const require = createRequire(new URL("../../packages/core/package.json", import.meta.url))
const { CreateBucketCommand, S3Client } = require("@aws-sdk/client-s3")

const [endpoint, bucket] = process.argv.slice(2)
if (!endpoint || !bucket) {
	console.error("usage: node create-bucket.mjs <endpoint> <bucket>")
	process.exit(1)
}

const client = new S3Client({
	endpoint,
	region: "us-east-1",
	forcePathStyle: true,
	credentials: {
		accessKeyId: process.env.E2E_S3_ACCESS_KEY_ID ?? "",
		secretAccessKey: process.env.E2E_S3_SECRET_ACCESS_KEY ?? "",
	},
})
await client.send(new CreateBucketCommand({ Bucket: bucket }))
console.log(`created bucket ${bucket}`)
