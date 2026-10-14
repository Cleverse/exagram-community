import { describe, expect, it } from "vitest"

import { decodeGcsServiceAccountKey, parseStorageEnv } from "./storage.env"

const s3Keys = {
	S3_ACCESS_KEY_ID: "minioadmin",
	S3_SECRET_ACCESS_KEY: "minioadmin",
}

describe("parseStorageEnv", () => {
	it("defaults to the s3 branch with no endpoint and virtual-hosted style when STORAGE_DRIVER is unset", () => {
		const env = parseStorageEnv(s3Keys)
		expect(env).toEqual({
			STORAGE_DRIVER: "s3",
			S3_REGION: "us-east-1",
			S3_BUCKET: "exagram",
			S3_ACCESS_KEY_ID: "minioadmin",
			S3_SECRET_ACCESS_KEY: "minioadmin",
			S3_FORCE_PATH_STYLE: false,
		})
	})

	it("treats an empty-string STORAGE_DRIVER as unset", () => {
		const env = parseStorageEnv({ STORAGE_DRIVER: "", ...s3Keys })
		expect(env.STORAGE_DRIVER).toBe("s3")
	})

	it("parses every optional S3 key set to empty the same as absent", () => {
		const empty = {
			S3_ENDPOINT: "",
			S3_PUBLIC_ENDPOINT: "",
			S3_REGION: "",
			S3_BUCKET: "",
			S3_ACCESS_KEY_ID: "",
			S3_SECRET_ACCESS_KEY: "",
			S3_FORCE_PATH_STYLE: "",
			S3_HTTP_HOSTS: "",
			GCS_BUCKET: "",
			GCS_PROJECT_ID: "",
			GCS_SERVICE_ACCOUNT_KEY_BASE64: "",
			GCS_CREATE_ONLY_UPLOADS: "",
			STORAGE_DIR: "",
		}
		expect(parseStorageEnv(empty)).toEqual(parseStorageEnv({}))
	})

	it("defaults GCS_CREATE_ONLY_UPLOADS to false and parses true", () => {
		expect(parseStorageEnv({ STORAGE_DRIVER: "gcs", GCS_BUCKET: "b" })).toMatchObject({
			GCS_CREATE_ONLY_UPLOADS: false,
		})
		expect(parseStorageEnv({ STORAGE_DRIVER: "gcs", GCS_BUCKET: "b", GCS_CREATE_ONLY_UPLOADS: "true" })).toMatchObject({
			GCS_CREATE_ONLY_UPLOADS: true,
		})
	})

	it("defaults path-style on when S3_ENDPOINT is set, and lets an explicit value win either way", () => {
		expect(parseStorageEnv({ S3_ENDPOINT: "http://localhost:9000" })).toMatchObject({ S3_FORCE_PATH_STYLE: true })
		expect(parseStorageEnv({ S3_ENDPOINT: "http://localhost:9000", S3_FORCE_PATH_STYLE: "false" })).toMatchObject({
			S3_FORCE_PATH_STYLE: false,
		})
		expect(parseStorageEnv({ S3_FORCE_PATH_STYLE: "true" })).toMatchObject({ S3_FORCE_PATH_STYLE: true })
	})

	it("accepts neither static key, for the SDK's default credential chain", () => {
		const env = parseStorageEnv({ STORAGE_DRIVER: "s3" })
		expect(env).not.toHaveProperty("S3_ACCESS_KEY_ID")
		expect(env).not.toHaveProperty("S3_SECRET_ACCESS_KEY")
	})

	it("refuses exactly one static key, naming both", () => {
		expect(() => parseStorageEnv({ STORAGE_DRIVER: "s3", S3_SECRET_ACCESS_KEY: "x" })).toThrow(
			/S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together/,
		)
		expect(() => parseStorageEnv({ S3_ACCESS_KEY_ID: "x", S3_SECRET_ACCESS_KEY: "" })).toThrow(
			/S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY/,
		)
	})

	it("allows an http S3_ENDPOINT on a loopback host", () => {
		for (const endpoint of [
			"http://localhost:9000",
			"http://127.0.0.1:9000",
			"http://127.8.9.10",
			"http://[::1]:9000",
		]) {
			expect(parseStorageEnv({ S3_ENDPOINT: endpoint })).toMatchObject({ S3_ENDPOINT: endpoint })
		}
	})

	it("allows an http S3_ENDPOINT on another host only when S3_HTTP_HOSTS lists it", () => {
		expect(() => parseStorageEnv({ S3_ENDPOINT: "http://minio:9000" })).toThrow(/S3_ENDPOINT.*minio/)
		expect(parseStorageEnv({ S3_ENDPOINT: "http://minio:9000", S3_HTTP_HOSTS: "minio" })).toMatchObject({
			S3_ENDPOINT: "http://minio:9000",
		})
		expect(() => parseStorageEnv({ S3_ENDPOINT: "http://store.internal:9000", S3_HTTP_HOSTS: "minio" })).toThrow(
			/S3_ENDPOINT.*store\.internal/,
		)
		expect(
			parseStorageEnv({ S3_ENDPOINT: "http://store.internal:9000", S3_HTTP_HOSTS: "minio, store.internal" }),
		).toMatchObject({ S3_ENDPOINT: "http://store.internal:9000" })
	})

	it("matches an IPv6 S3_HTTP_HOSTS entry with or without brackets", () => {
		for (const hosts of ["fd00::1", "[fd00::1]", "minio, [FD00::1] "]) {
			expect(parseStorageEnv({ S3_ENDPOINT: "http://[fd00::1]:9000", S3_HTTP_HOSTS: hosts })).toMatchObject({
				S3_ENDPOINT: "http://[fd00::1]:9000",
			})
		}
		expect(() => parseStorageEnv({ S3_ENDPOINT: "http://[fd00::1]:9000", S3_HTTP_HOSTS: "fd00::2" })).toThrow(
			/S3_ENDPOINT/,
		)
	})

	it("allows any https S3_ENDPOINT", () => {
		expect(parseStorageEnv({ S3_ENDPOINT: "https://s3.example.test" })).toMatchObject({
			S3_ENDPOINT: "https://s3.example.test",
		})
	})

	it("requires https for a non-loopback S3_PUBLIC_ENDPOINT, whatever S3_HTTP_HOSTS lists", () => {
		expect(parseStorageEnv({ S3_PUBLIC_ENDPOINT: "http://localhost:9000" })).toMatchObject({
			S3_PUBLIC_ENDPOINT: "http://localhost:9000",
		})
		expect(parseStorageEnv({ S3_PUBLIC_ENDPOINT: "https://s3.example.test" })).toMatchObject({
			S3_PUBLIC_ENDPOINT: "https://s3.example.test",
		})
		expect(() => parseStorageEnv({ S3_PUBLIC_ENDPOINT: "http://minio:9000", S3_HTTP_HOSTS: "minio" })).toThrow(
			/S3_PUBLIC_ENDPOINT.*minio/,
		)
	})

	it("parses gcs with only GCS_BUCKET, with no S3 keys present", () => {
		const env = parseStorageEnv({ STORAGE_DRIVER: "gcs", GCS_BUCKET: "exagram-bucket" })
		expect(env).toEqual({ STORAGE_DRIVER: "gcs", GCS_BUCKET: "exagram-bucket", GCS_CREATE_ONLY_UPLOADS: false })
	})

	it("throws for gcs without a bucket", () => {
		expect(() => parseStorageEnv({ STORAGE_DRIVER: "gcs" })).toThrow()
		expect(() => parseStorageEnv({ STORAGE_DRIVER: "gcs", GCS_BUCKET: "" })).toThrow()
	})

	it("throws when GCS_SERVICE_ACCOUNT_KEY_BASE64 is not base64-JSON with client_email and private_key", () => {
		expect(() =>
			parseStorageEnv({
				STORAGE_DRIVER: "gcs",
				GCS_BUCKET: "b",
				GCS_SERVICE_ACCOUNT_KEY_BASE64: Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64"),
			}),
		).toThrow()
	})

	it("parses filesystem with an absolute STORAGE_DIR", () => {
		expect(parseStorageEnv({ STORAGE_DRIVER: "filesystem", STORAGE_DIR: "/var/lib/exagram/objects" })).toEqual({
			STORAGE_DRIVER: "filesystem",
			STORAGE_DIR: "/var/lib/exagram/objects",
		})
	})

	it("refuses filesystem without STORAGE_DIR, or with an empty or relative one", () => {
		expect(() => parseStorageEnv({ STORAGE_DRIVER: "filesystem" })).toThrow(/STORAGE_DIR/)
		expect(() => parseStorageEnv({ STORAGE_DRIVER: "filesystem", STORAGE_DIR: "" })).toThrow(/STORAGE_DIR/)
		expect(() => parseStorageEnv({ STORAGE_DRIVER: "filesystem", STORAGE_DIR: "data/objects" })).toThrow(
			/STORAGE_DIR must be an absolute path/,
		)
	})
})

describe("decodeGcsServiceAccountKey", () => {
	it("decodes base64 JSON with client_email and private_key", () => {
		const key = Buffer.from(
			JSON.stringify({ client_email: "a@b.iam.gserviceaccount.com", private_key: "pk" }),
		).toString("base64")
		expect(decodeGcsServiceAccountKey(key)).toEqual({ client_email: "a@b.iam.gserviceaccount.com", private_key: "pk" })
	})

	it("throws for invalid base64-JSON", () => {
		expect(() => decodeGcsServiceAccountKey("not-base64-json")).toThrow()
	})
})
