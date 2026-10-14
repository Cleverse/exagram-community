import { beforeEach, describe, expect, it, vi } from "vitest"

const {
	gcsObjectStoreModule,
	gcsSignerModule,
	googleCloudStorageModule,
	s3SignerModule,
	awsClientS3Module,
	storageCtorCalls,
	s3ClientCtorCalls,
} = vi.hoisted(() => {
	const storageCtorCalls: unknown[] = []
	const s3ClientCtorCalls: Record<string, unknown>[] = []

	class FakeGcsObjectStore {
		constructor(public bucket: unknown) {}
	}
	class FakeGcsUploadSigner {
		constructor(
			public bucket: unknown,
			public config: unknown,
		) {}
	}
	class FakeStorage {
		constructor(public options: unknown) {
			storageCtorCalls.push(options)
		}
		bucket(name: string) {
			return { name }
		}
	}
	class FakeS3Client {
		constructor(public config: Record<string, unknown>) {
			s3ClientCtorCalls.push(config)
		}
	}
	class FakeS3UploadSigner {
		constructor(public config: unknown) {}
	}

	return {
		gcsObjectStoreModule: vi.fn(() => ({ GcsObjectStore: FakeGcsObjectStore })),
		gcsSignerModule: vi.fn(() => ({ GcsUploadSigner: FakeGcsUploadSigner })),
		googleCloudStorageModule: vi.fn(() => ({ Storage: FakeStorage })),
		s3SignerModule: vi.fn(() => ({ S3UploadSigner: FakeS3UploadSigner })),
		awsClientS3Module: vi.fn(() => ({ S3Client: FakeS3Client })),
		storageCtorCalls,
		s3ClientCtorCalls,
	}
})

vi.mock("./gcs.object-store", gcsObjectStoreModule)
vi.mock("./gcs.signer", gcsSignerModule)
vi.mock("@google-cloud/storage", googleCloudStorageModule)
vi.mock("./s3.signer", s3SignerModule)
vi.mock("@aws-sdk/client-s3", awsClientS3Module)

const s3Cfg = {
	STORAGE_DRIVER: "s3" as const,
	S3_ENDPOINT: "http://localhost:9000",
	S3_REGION: "us-east-1",
	S3_BUCKET: "exagram",
	S3_ACCESS_KEY_ID: "minioadmin",
	S3_SECRET_ACCESS_KEY: "minioadmin",
	S3_FORCE_PATH_STYLE: true,
}

const gcsCfg = {
	STORAGE_DRIVER: "gcs" as const,
	GCS_BUCKET: "exagram-bucket",
	GCS_PROJECT_ID: "example-project",
	GCS_CREATE_ONLY_UPLOADS: false,
}

beforeEach(() => {
	gcsObjectStoreModule.mockClear()
	gcsSignerModule.mockClear()
	googleCloudStorageModule.mockClear()
	s3SignerModule.mockClear()
	awsClientS3Module.mockClear()
	storageCtorCalls.length = 0
	s3ClientCtorCalls.length = 0
})

describe("createObjectStore / createUploadSigner", () => {
	it("s3 config constructs only the S3 path; the gcs modules are never loaded", async () => {
		const { createObjectStore, createUploadSigner } = await import("./storage.factory")

		await createObjectStore(s3Cfg)
		await createUploadSigner(s3Cfg, { ticketTtlSeconds: 300 })

		expect(awsClientS3Module).toHaveBeenCalled()
		expect(s3SignerModule).toHaveBeenCalled()
		expect(gcsObjectStoreModule).not.toHaveBeenCalled()
		expect(gcsSignerModule).not.toHaveBeenCalled()
		expect(googleCloudStorageModule).not.toHaveBeenCalled()
	})

	it("s3 object store client gets endpoint and credentials when set, and WHEN_REQUIRED checksums", async () => {
		const { createObjectStore } = await import("./storage.factory")

		await createObjectStore(s3Cfg)

		expect(s3ClientCtorCalls).toEqual([
			{
				endpoint: "http://localhost:9000",
				region: "us-east-1",
				forcePathStyle: true,
				credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
				requestChecksumCalculation: "WHEN_REQUIRED",
				responseChecksumValidation: "WHEN_REQUIRED",
			},
		])
	})

	it("s3 object store client omits endpoint and credentials when unset, for AWS and the default chain", async () => {
		const { createObjectStore } = await import("./storage.factory")

		await createObjectStore({
			STORAGE_DRIVER: "s3",
			S3_REGION: "eu-west-1",
			S3_BUCKET: "exagram",
			S3_FORCE_PATH_STYLE: false,
		})

		expect(s3ClientCtorCalls).toEqual([
			{
				region: "eu-west-1",
				forcePathStyle: false,
				requestChecksumCalculation: "WHEN_REQUIRED",
				responseChecksumValidation: "WHEN_REQUIRED",
			},
		])
	})

	it("gcs config constructs only the GCS path; the s3 modules are never loaded", async () => {
		const { createObjectStore, createUploadSigner } = await import("./storage.factory")

		await createObjectStore(gcsCfg)
		await createUploadSigner(gcsCfg, { ticketTtlSeconds: 300 })

		expect(gcsObjectStoreModule).toHaveBeenCalled()
		expect(gcsSignerModule).toHaveBeenCalled()
		expect(googleCloudStorageModule).toHaveBeenCalled()
		expect(s3SignerModule).not.toHaveBeenCalled()
		expect(awsClientS3Module).not.toHaveBeenCalled()
	})

	it("passes GCS_CREATE_ONLY_UPLOADS to the gcs signer", async () => {
		const { createUploadSigner } = await import("./storage.factory")

		const signer = await createUploadSigner({ ...gcsCfg, GCS_CREATE_ONLY_UPLOADS: true }, { ticketTtlSeconds: 300 })

		expect(signer).toMatchObject({ config: { ticketTtlSeconds: 300, createOnly: true } })
	})

	it("filesystem config constructs the filesystem store and signer; neither s3 nor gcs is loaded", async () => {
		const { createObjectStore, createUploadSigner } = await import("./storage.factory")
		const { FilesystemObjectStore } = await import("./filesystem.object-store")
		const { FilesystemUploadSigner } = await import("./filesystem.signer")
		const fsCfg = { STORAGE_DRIVER: "filesystem" as const, STORAGE_DIR: "/var/lib/exagram/objects" }

		expect(await createObjectStore(fsCfg)).toBeInstanceOf(FilesystemObjectStore)
		expect(
			await createUploadSigner(fsCfg, {
				ticketTtlSeconds: 300,
				filesystem: { uploadOrigin: "https://app.example.test", secret: "0123456789abcdef0123456789abcdef" },
			}),
		).toBeInstanceOf(FilesystemUploadSigner)
		await expect(createUploadSigner(fsCfg, { ticketTtlSeconds: 300 })).rejects.toThrow(/UPLOAD_TOKEN_SECRET/)

		expect(awsClientS3Module).not.toHaveBeenCalled()
		expect(s3SignerModule).not.toHaveBeenCalled()
		expect(googleCloudStorageModule).not.toHaveBeenCalled()
		expect(gcsSignerModule).not.toHaveBeenCalled()
	})

	it("passes the decoded service-account key as credentials when GCS_SERVICE_ACCOUNT_KEY_BASE64 is set", async () => {
		const { createObjectStore } = await import("./storage.factory")
		const key = Buffer.from(
			JSON.stringify({ client_email: "a@b.iam.gserviceaccount.com", private_key: "pk" }),
		).toString("base64")

		await createObjectStore({ ...gcsCfg, GCS_SERVICE_ACCOUNT_KEY_BASE64: key })

		expect(storageCtorCalls).toEqual([
			{ projectId: "example-project", credentials: { client_email: "a@b.iam.gserviceaccount.com", private_key: "pk" } },
		])
	})

	it("constructs Storage with no credentials, ambient, when the key is unset", async () => {
		const { createObjectStore } = await import("./storage.factory")

		await createObjectStore(gcsCfg)

		expect(storageCtorCalls).toEqual([{ projectId: "example-project" }])
	})
})
