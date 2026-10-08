import { link, mkdir, mkdtemp, open, readdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ObjectNotFoundError } from "../object-store.service"

import {
	FilesystemObjectStore,
	InvalidStorageKeyError,
	ObjectExistsError,
	UploadIdleTimeoutError,
	UploadSizeMismatchError,
} from "./filesystem.object-store"

import type * as FsPromises from "node:fs/promises"
import type { FileHandle } from "node:fs/promises"

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof FsPromises>()
	return { ...actual, link: vi.fn(actual.link), open: vi.fn(actual.open) }
})

let root: string
let dir: string
let store: FilesystemObjectStore

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "exagram-fs-store-"))
	dir = join(root, "objects")
	store = new FilesystemObjectStore(dir)
})

afterEach(async () => {
	await rm(root, { recursive: true, force: true })
})

const bytes = (text: string) => new TextEncoder().encode(text)
const tmpEntries = async () => readdir(join(dir, ".tmp")).catch(() => [])

describe("FilesystemObjectStore", () => {
	it("put then get, getText, getStream and head round-trip bytes and mime", async () => {
		await store.put({ key: "bodies/abc", bytes: bytes("# plan"), mime: "text/markdown" })

		expect(await store.getText("bodies/abc")).toBe("# plan")
		expect(Buffer.from(await store.get("bodies/abc")).toString()).toBe("# plan")
		expect(await store.head("bodies/abc")).toEqual({ bytes: 6, mime: "text/markdown" })
		const object = await store.getStream("bodies/abc")
		expect(object.contentLength).toBe(6)
		const chunks: Buffer[] = []
		for await (const chunk of object.stream) chunks.push(chunk as Buffer)
		expect(Buffer.concat(chunks).toString()).toBe("# plan")
		expect(JSON.parse(await readFile(join(dir, "bodies/abc.meta.json"), "utf8"))).toEqual({ mime: "text/markdown" })
	})

	it("put replaces an existing object", async () => {
		await store.put({ key: "a/b", bytes: bytes("one"), mime: "text/plain" })
		await store.put({ key: "a/b", bytes: bytes("three"), mime: "text/markdown" })

		expect(await store.getText("a/b")).toBe("three")
		expect(await store.head("a/b")).toEqual({ bytes: 5, mime: "text/markdown" })
		expect(await tmpEntries()).toEqual([])
	})

	it("treats a missing key as not found", async () => {
		expect(await store.head("a/missing")).toBeNull()
		await expect(store.getStream("a/missing")).rejects.toBeInstanceOf(ObjectNotFoundError)
		await expect(store.get("a/missing")).rejects.toBeInstanceOf(ObjectNotFoundError)
	})

	it("treats a directory, or a path under a file, as not found", async () => {
		await store.put({ key: "a/b", bytes: bytes("x"), mime: "text/plain" })

		expect(await store.head("a")).toBeNull()
		await expect(store.getStream("a")).rejects.toBeInstanceOf(ObjectNotFoundError)
		expect(await store.head("a/b/c")).toBeNull()
		await expect(store.getStream("a/b/c")).rejects.toBeInstanceOf(ObjectNotFoundError)
	})

	it("treats a sidecar that is not JSON, or has no string mime, as no object", async () => {
		for (const [key, sidecar] of [
			["a/garbled", "{not json"],
			["a/nomime", '{"type":"text/plain"}'],
			["a/numeric", '{"mime":42}'],
			["a/null", "null"],
		] as const) {
			await store.put({ key, bytes: bytes("x"), mime: "text/plain" })
			await writeFile(join(dir, `${key}.meta.json`), sidecar)
			expect(await store.head(key)).toBeNull()
			await expect(store.getStream(key)).rejects.toBeInstanceOf(ObjectNotFoundError)
		}
	})

	it("closes the file handle when stat fails before the stream takes it", async () => {
		await store.put({ key: "a/b", bytes: bytes("x"), mime: "text/plain" })
		const close = vi.fn(() => Promise.resolve())
		const handle = { stat: () => Promise.reject(new Error("stat failed")), close }
		vi.mocked(open).mockResolvedValueOnce(handle as unknown as FileHandle)

		await expect(store.getStream("a/b")).rejects.toThrow("stat failed")

		expect(close).toHaveBeenCalledOnce()
	})

	it("closes the file handle when the key names a directory", async () => {
		await store.put({ key: "a/b", bytes: bytes("x"), mime: "text/plain" })
		const close = vi.fn(() => Promise.resolve())
		const handle = { stat: () => Promise.resolve({ isFile: () => false }), close }
		vi.mocked(open).mockResolvedValueOnce(handle as unknown as FileHandle)

		await expect(store.getStream("a")).rejects.toBeInstanceOf(ObjectNotFoundError)

		expect(close).toHaveBeenCalledOnce()
	})

	it("delete removes body and sidecar and ignores a missing key", async () => {
		await store.put({ key: "a/b", bytes: bytes("x"), mime: "text/plain" })

		await store.delete("a/b")
		await store.delete("a/b")

		expect(await store.head("a/b")).toBeNull()
		expect(await readdir(join(dir, "a"))).toEqual([])
	})

	describe("key confinement", () => {
		const refused = [
			"",
			"/etc/passwd",
			"a\\b",
			"a\0b",
			"a//b",
			"a/",
			"/a",
			"./a",
			"a/./b",
			"..",
			"a/../b",
			"artifacts/id/../../x",
			"a/.hidden",
			".tmp/x",
			"a/b.meta.json",
		]

		beforeEach(async () => {
			// Something real for a traversal to find if confinement failed.
			await writeFile(join(root, "x"), "outside")
			await store.put({ key: "a/b", bytes: bytes("inside"), mime: "text/plain" })
		})

		it.each(refused)("reads %j as not found", async (key) => {
			expect(await store.head(key)).toBeNull()
			await expect(store.getStream(key)).rejects.toBeInstanceOf(ObjectNotFoundError)
		})

		it.each(refused)("refuses writes to %j", async (key) => {
			await expect(store.put({ key, bytes: bytes("x"), mime: "text/plain" })).rejects.toBeInstanceOf(
				InvalidStorageKeyError,
			)
			await expect(
				store.writeUpload(key, Readable.from([Buffer.from("x")]), { mime: "text/plain", bytes: 1 }),
			).rejects.toBeInstanceOf(InvalidStorageKeyError)
			await expect(store.delete(key)).rejects.toBeInstanceOf(InvalidStorageKeyError)
		})

		it("leaves files outside the directory untouched", async () => {
			expect(await readFile(join(root, "x"), "utf8")).toBe("outside")
		})

		it("accepts a well-formed key", async () => {
			expect(await store.head("a/b")).toEqual({ bytes: 6, mime: "text/plain" })
		})
	})

	describe("writeUpload", () => {
		const upload = (key: string, chunks: string[], signed: { mime: string; bytes: number }) =>
			store.writeUpload(key, Readable.from(chunks.map((chunk) => Buffer.from(chunk))), signed)

		it("stores a body of exactly the signed size, with its mime", async () => {
			await upload("artifacts/a/1", ["hello ", "world"], { mime: "text/plain", bytes: 11 })

			expect(await store.getText("artifacts/a/1")).toBe("hello world")
			expect(await store.head("artifacts/a/1")).toEqual({ bytes: 11, mime: "text/plain" })
			expect(await tmpEntries()).toEqual([])
		})

		it("discards a body longer than signed", async () => {
			await expect(
				upload("artifacts/a/1", ["hello ", "world"], { mime: "text/plain", bytes: 5 }),
			).rejects.toBeInstanceOf(UploadSizeMismatchError)
			expect(await store.head("artifacts/a/1")).toBeNull()
			expect(await tmpEntries()).toEqual([])
		})

		it("discards a body shorter than signed", async () => {
			await expect(upload("artifacts/a/1", ["hello"], { mime: "text/plain", bytes: 11 })).rejects.toBeInstanceOf(
				UploadSizeMismatchError,
			)
			expect(await store.head("artifacts/a/1")).toBeNull()
			expect(await tmpEntries()).toEqual([])
		})

		it("refuses to overwrite an existing object, keeping its bytes and mime", async () => {
			await upload("artifacts/a/1", ["first"], { mime: "text/plain", bytes: 5 })

			await expect(upload("artifacts/a/1", ["other"], { mime: "text/html", bytes: 5 })).rejects.toBeInstanceOf(
				ObjectExistsError,
			)
			expect(await store.getText("artifacts/a/1")).toBe("first")
			expect(await store.head("artifacts/a/1")).toEqual({ bytes: 5, mime: "text/plain" })
			expect(await tmpEntries()).toEqual([])
		})

		it("cuts off an upload that goes quiet, keeping nothing and leaving the source alone", async () => {
			const slow = new FilesystemObjectStore(dir, { uploadIdleMs: 50 })
			const stalled = new Readable({ read() {} })
			stalled.push(Buffer.from("abc"))

			await expect(
				slow.writeUpload("artifacts/a/1", stalled, { mime: "text/plain", bytes: 10 }),
			).rejects.toBeInstanceOf(UploadIdleTimeoutError)
			expect(await slow.head("artifacts/a/1")).toBeNull()
			expect(await tmpEntries()).toEqual([])
			expect(stalled.destroyed).toBe(false)
		})

		it("does not cut off an upload whose chunks keep arriving inside the idle window", async () => {
			const slow = new FilesystemObjectStore(dir, { uploadIdleMs: 200 })
			const trickle = new Readable({ read() {} })
			const feed = (async () => {
				for (const chunk of ["a", "b", "c"]) {
					trickle.push(Buffer.from(chunk))
					await new Promise((done) => setTimeout(done, 100))
				}
				trickle.push(null)
			})()

			await slow.writeUpload("artifacts/a/1", trickle, { mime: "text/plain", bytes: 3 })
			await feed
			expect(await slow.getText("artifacts/a/1")).toBe("abc")
		})

		it("removes the sidecar it created when linking the body fails for a reason other than EEXIST", async () => {
			vi.mocked(link)
				.mockImplementationOnce(async (from, to) =>
					(await vi.importActual<typeof FsPromises>("node:fs/promises")).link(from, to),
				)
				.mockRejectedValueOnce(Object.assign(new Error("input/output error"), { code: "EIO" }))

			await expect(upload("artifacts/a/1", ["hello"], { mime: "text/plain", bytes: 5 })).rejects.toThrow(
				"input/output error",
			)
			await expect(readFile(join(dir, "artifacts/a/1.meta.json"))).rejects.toMatchObject({ code: "ENOENT" })
			expect(await store.head("artifacts/a/1")).toBeNull()
			expect(await tmpEntries()).toEqual([])
		})

		it("fails and cleans up when the source errors mid-stream, without destroying it on overflow", async () => {
			const failing = new Readable({
				read() {
					this.push(Buffer.from("abc"))
					this.destroy(new Error("connection reset"))
				},
			})
			await expect(store.writeUpload("artifacts/a/1", failing, { mime: "text/plain", bytes: 10 })).rejects.toThrow(
				"connection reset",
			)
			expect(await store.head("artifacts/a/1")).toBeNull()
			expect(await tmpEntries()).toEqual([])

			// Never ends, like a client still sending: the caller must still be able to answer on it.
			const long = new Readable({ read() {} })
			long.push(Buffer.from("0123456789"))
			await expect(store.writeUpload("artifacts/a/2", long, { mime: "text/plain", bytes: 3 })).rejects.toBeInstanceOf(
				UploadSizeMismatchError,
			)
			expect(long.destroyed).toBe(false)
		})
	})
})

describe("sweep helpers", () => {
	const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
	const age = async (path: string) => utimes(path, new Date(0), new Date(0))
	const list = async (prefix: string, before: Date, since = new Date(0)) => {
		const keys: string[] = []
		for await (const key of store.listModifiedBetween(prefix, since, before)) keys.push(key)
		return keys.sort()
	}

	it("listModifiedBetween yields old bodies only, never sidecars, dot-entries or symlinks", async () => {
		await store.put({ key: "artifacts/a/old", bytes: bytes("old"), mime: "text/plain" })
		await store.put({ key: "artifacts/a/young", bytes: bytes("young"), mime: "text/plain" })
		await store.put({ key: "bodies/old", bytes: bytes("old"), mime: "text/plain" })
		await age(join(dir, "artifacts/a/old"))
		await age(join(dir, "artifacts/a/old.meta.json"))
		await age(join(dir, "bodies/old"))
		await writeFile(join(dir, "artifacts/a/.hidden"), "x")
		await age(join(dir, "artifacts/a/.hidden"))
		const outside = join(root, "outside")
		await mkdir(outside)
		await writeFile(join(outside, "file"), "x")
		await age(join(outside, "file"))
		await symlink(outside, join(dir, "artifacts/linked-dir"))
		await symlink(join(outside, "file"), join(dir, "artifacts/a/linked-file"))

		expect(await list("artifacts", hourAgo)).toEqual(["artifacts/a/old"])
	})

	it("listModifiedBetween leaves out bodies last written before `since`", async () => {
		await store.put({ key: "artifacts/a/ancient", bytes: bytes("x"), mime: "text/plain" })
		await store.put({ key: "artifacts/a/old", bytes: bytes("x"), mime: "text/plain" })
		await age(join(dir, "artifacts/a/ancient"))
		const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
		await utimes(join(dir, "artifacts/a/old"), dayAgo, dayAgo)

		expect(await list("artifacts", hourAgo, new Date(1000))).toEqual(["artifacts/a/old"])
	})

	it("listModifiedBetween yields nothing for a prefix that doesn't exist and refuses one that escapes", async () => {
		expect(await list("artifacts", hourAgo)).toEqual([])
		await expect(list("../x", hourAgo)).rejects.toBeInstanceOf(InvalidStorageKeyError)
	})

	it("listRootModifiedBetween walks only root directories whose name matches, and yields bodies only", async () => {
		await store.put({ key: "abc/old", bytes: bytes("old"), mime: "text/plain" })
		await store.put({ key: "abc/young", bytes: bytes("young"), mime: "text/plain" })
		await store.put({ key: "other/old", bytes: bytes("old"), mime: "text/plain" })
		await store.put({ key: "artifacts/abc/old", bytes: bytes("old"), mime: "text/plain" })
		await writeFile(join(dir, "abc-file"), "x")
		for (const path of ["abc/old", "abc/old.meta.json", "other/old", "artifacts/abc/old", "abc-file"])
			await age(join(dir, path))
		await mkdir(join(dir, ".tmp"), { recursive: true })
		await writeFile(join(dir, ".tmp/abc"), "x")
		await age(join(dir, ".tmp/abc"))

		const keys: string[] = []
		for await (const key of store.listRootModifiedBetween(/^abc$/, new Date(0), hourAgo)) keys.push(key)

		expect(keys).toEqual(["abc/old"])
	})

	it("listRootModifiedBetween yields nothing before the store directory exists", async () => {
		const keys: string[] = []
		for await (const key of store.listRootModifiedBetween(/./, new Date(0), hourAgo)) keys.push(key)
		expect(keys).toEqual([])
	})

	it("deleteTempOlderThan removes only stale temp files", async () => {
		await mkdir(join(dir, ".tmp"), { recursive: true })
		await writeFile(join(dir, ".tmp/stale"), "x")
		await age(join(dir, ".tmp/stale"))
		await writeFile(join(dir, ".tmp/live"), "x")

		expect(await store.deleteTempOlderThan(hourAgo)).toBe(1)
		expect(await tmpEntries()).toEqual(["live"])
	})

	it("deleteTempOlderThan is a no-op before any upload made the temp directory", async () => {
		expect(await store.deleteTempOlderThan(hourAgo)).toBe(0)
	})

	describe("deleteOrphanSidecarsOlderThan", () => {
		const uuid = "11111111-1111-4111-8111-111111111111"
		const sweep = () => store.deleteOrphanSidecarsOlderThan(/^[0-9a-f-]{36}$/, hourAgo)
		const sidecar = async (key: string) => {
			await mkdir(join(dir, key, ".."), { recursive: true })
			await writeFile(join(dir, key + ".meta.json"), "{}")
		}
		const exists = (path: string) =>
			readFile(join(dir, path)).then(
				() => true,
				() => false,
			)

		it("removes an old sidecar with no body, under artifacts/ and a matching root directory", async () => {
			await sidecar("artifacts/a/orphan")
			await sidecar(`${uuid}/orphan`)
			await age(join(dir, "artifacts/a/orphan.meta.json"))
			await age(join(dir, `${uuid}/orphan.meta.json`))

			expect(await sweep()).toBe(2)
			expect(await exists("artifacts/a/orphan.meta.json")).toBe(false)
			expect(await exists(`${uuid}/orphan.meta.json`)).toBe(false)
		})

		it("keeps a young sidecar with no body", async () => {
			await sidecar("artifacts/a/young")

			expect(await sweep()).toBe(0)
			expect(await exists("artifacts/a/young.meta.json")).toBe(true)
		})

		it("keeps an old sidecar whose body exists", async () => {
			await store.put({ key: "artifacts/a/kept", bytes: bytes("x"), mime: "text/plain" })
			await age(join(dir, "artifacts/a/kept.meta.json"))

			expect(await sweep()).toBe(0)
			expect(await exists("artifacts/a/kept.meta.json")).toBe(true)
		})

		it("ignores sidecars under other root directories", async () => {
			await sidecar("other/orphan")
			await age(join(dir, "other/orphan.meta.json"))

			expect(await sweep()).toBe(0)
			expect(await exists("other/orphan.meta.json")).toBe(true)
		})

		it("is a no-op on an empty store", async () => {
			expect(await sweep()).toBe(0)
		})
	})
})
