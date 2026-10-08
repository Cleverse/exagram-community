import type { S3ClientConfig } from "@aws-sdk/client-s3"

/** Options every S3Client gets, the object store's included. */
export const s3ClientConfig = (config: {
	endpoint?: string
	region: string
	forcePathStyle: boolean
	accessKeyId?: string
	secretAccessKey?: string
}): S3ClientConfig => ({
	...(config.endpoint !== undefined && { endpoint: config.endpoint }),
	region: config.region,
	forcePathStyle: config.forcePathStyle,
	...(config.accessKeyId !== undefined &&
		config.secretAccessKey !== undefined && {
			credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
		}),
	// The SDK's default adds CRC32 checksums, which a presigned PUT then signs for an empty body and
	// several S3-compatible stores reject; send them only where the operation requires one.
	requestChecksumCalculation: "WHEN_REQUIRED",
	responseChecksumValidation: "WHEN_REQUIRED",
})
