import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { s3ClientConfig } from "./s3.client-config"

import type { UploadTicket } from "./object-storage.port"
import type { UploadSigner } from "./upload-signer.port"

export interface S3SignerConfig {
	// Unset means the SDK's own endpoint for `region` (AWS).
	endpoint?: string
	// Endpoint presigned URLs are addressed to in place of `endpoint`; defaults to `endpoint` when
	// unset, so callers outside docker compose (e.g. the Testcontainers test lanes) are unaffected.
	// SigV4 signs the Host header, so this has to be the endpoint a second client presigns against,
	// not a host swapped into the URL after the fact — that would invalidate the signature.
	publicEndpoint?: string
	region: string
	bucket: string
	// Both or neither; neither means the SDK's default credential chain.
	accessKeyId?: string
	secretAccessKey?: string
	forcePathStyle: boolean
	ticketTtlSeconds: number
}

export class S3UploadSigner implements UploadSigner {
	private readonly presignClient: S3Client

	constructor(private readonly config: S3SignerConfig) {
		this.presignClient = new S3Client(s3ClientConfig({ ...config, endpoint: config.publicEndpoint ?? config.endpoint }))
	}

	async createUploadTicket(input: {
		storageKey: string
		mime: string
		bytes: number
		createOnly?: boolean
	}): Promise<UploadTicket> {
		const url = await getSignedUrl(
			this.presignClient,
			new PutObjectCommand({
				Bucket: this.config.bucket,
				Key: input.storageKey,
				ContentType: input.mime,
				ContentLength: input.bytes,
				IfNoneMatch: "*",
			}),
			{
				expiresIn: this.config.ticketTtlSeconds,
				// The size is part of the signature: a PUT of any other length fails at the storage server.
				// if-none-match is signed too: an unsigned header could be left off, and a replayed PUT would
				// then overwrite the settled Revision's bytes.
				signableHeaders: new Set(["content-length", "content-type", "if-none-match"]),
			},
		)
		return {
			url,
			storageKey: input.storageKey,
			expiresInSeconds: this.config.ticketTtlSeconds,
			requiredHeaders: {
				"content-length": String(input.bytes),
				"content-type": input.mime,
				"if-none-match": "*",
			},
		}
	}
}
