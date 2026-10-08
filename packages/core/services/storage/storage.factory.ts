import { s3ClientConfig } from "./s3.client-config"
import { decodeGcsServiceAccountKey } from "./storage.env"

import type { ObjectStore } from "../object-store.service"
import type { StorageEnv } from "./storage.env"
import type { UploadSigner } from "./upload-signer.port"
import type { Bucket } from "@google-cloud/storage"

type GcsEnv = Extract<StorageEnv, { STORAGE_DRIVER: "gcs" }>

async function gcsBucket(cfg: GcsEnv): Promise<Bucket> {
	const { Storage } = await import("@google-cloud/storage")
	const storage = cfg.GCS_SERVICE_ACCOUNT_KEY_BASE64
		? new Storage({
				projectId: cfg.GCS_PROJECT_ID,
				credentials: decodeGcsServiceAccountKey(cfg.GCS_SERVICE_ACCOUNT_KEY_BASE64),
			})
		: new Storage({ projectId: cfg.GCS_PROJECT_ID })
	return storage.bucket(cfg.GCS_BUCKET)
}

export async function createObjectStore(cfg: StorageEnv): Promise<ObjectStore> {
	if (cfg.STORAGE_DRIVER === "gcs") {
		const { GcsObjectStore } = await import("./gcs.object-store")
		return new GcsObjectStore(await gcsBucket(cfg))
	}
	if (cfg.STORAGE_DRIVER === "filesystem") {
		const { FilesystemObjectStore } = await import("./filesystem.object-store")
		return new FilesystemObjectStore(cfg.STORAGE_DIR)
	}

	const { S3Client } = await import("@aws-sdk/client-s3")
	const { S3ObjectStore } = await import("../object-store.service")
	const client = new S3Client(
		s3ClientConfig({
			endpoint: cfg.S3_ENDPOINT,
			region: cfg.S3_REGION,
			forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
			accessKeyId: cfg.S3_ACCESS_KEY_ID,
			secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
		}),
	)
	return new S3ObjectStore(client, cfg.S3_BUCKET)
}

export async function createUploadSigner(
	cfg: StorageEnv,
	options: {
		ticketTtlSeconds: number
		/** Required for the filesystem driver, whose tickets point at the api's own upload route. */
		filesystem?: { uploadOrigin: string; secret: string }
	},
): Promise<UploadSigner> {
	if (cfg.STORAGE_DRIVER === "gcs") {
		const { GcsUploadSigner } = await import("./gcs.signer")
		return new GcsUploadSigner(await gcsBucket(cfg), {
			ticketTtlSeconds: options.ticketTtlSeconds,
			createOnly: cfg.GCS_CREATE_ONLY_UPLOADS,
		})
	}
	if (cfg.STORAGE_DRIVER === "filesystem") {
		if (options.filesystem === undefined) {
			throw new Error("the filesystem storage driver needs an upload origin and UPLOAD_TOKEN_SECRET to sign uploads")
		}
		const { FilesystemUploadSigner } = await import("./filesystem.signer")
		return new FilesystemUploadSigner({ ...options.filesystem, ticketTtlSeconds: options.ticketTtlSeconds })
	}

	const { S3UploadSigner } = await import("./s3.signer")
	return new S3UploadSigner({
		endpoint: cfg.S3_ENDPOINT,
		publicEndpoint: cfg.S3_PUBLIC_ENDPOINT,
		region: cfg.S3_REGION,
		bucket: cfg.S3_BUCKET,
		accessKeyId: cfg.S3_ACCESS_KEY_ID,
		secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
		forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
		ticketTtlSeconds: options.ticketTtlSeconds,
	})
}
