import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { link, lstat, mkdir, open, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve, sep } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { ObjectNotFoundError } from "../object-store.service"

import type { ObjectStore, ObjectStream } from "../object-store.service"
import type { Readable } from "node:stream"

const META_SUFFIX = ".meta.json"

/** A key the store refuses to map to a path; reads treat it as not-found. */
export class InvalidStorageKeyError extends Error {
	constructor() {
		super("invalid storage key")
		this.name = "InvalidStorageKeyError"
	}
}

/** An upload aimed at a key that already holds an object; the first write wins. */
export class ObjectExistsError extends Error {
	constructor() {
		super("object already exists")
		this.name = "ObjectExistsError"
	}
}

/** An upload whose body was not exactly the signed byte count; nothing was stored. */
export class UploadSizeMismatchError extends Error {
	constructor() {
		super("upload size does not match the ticket")
		this.name = "UploadSizeMismatchError"
	}
}

/** An upload that went quiet: no body bytes for the idle window; nothing was stored. */
export class UploadIdleTimeoutError extends Error {
	constructor() {
		super("upload stalled")
		this.name = "UploadIdleTimeoutError"
	}
}

/** How long an upload may go without a body byte before it is cut off. */
export const UPLOAD_IDLE_TIMEOUT_MS = 30_000

const isMissing = (error: unknown): boolean => {
	const code = (error as { code?: string })?.code
	return code === "ENOENT" || code === "ENOTDIR"
}

/**
 * Objects under one directory: the body at `<dir>/<key>`, its mime in `<dir>/<key>.meta.json`
 * (not xattrs, which Docker volumes don't reliably keep). Temp files live in `<dir>/.tmp`, on the
 * same filesystem so `link` and `rename` are atomic, and out of reach of any key since keys can't
 * have dot-segments.
 */
export class FilesystemObjectStore implements ObjectStore {
	private readonly dir: string
	private readonly tmpDir: string
	private readonly uploadIdleMs: number

	constructor(dir: string, options: { uploadIdleMs?: number } = {}) {
		this.uploadIdleMs = options.uploadIdleMs ?? UPLOAD_IDLE_TIMEOUT_MS
		this.dir = resolve(dir)
		this.tmpDir = join(this.dir, ".tmp")
	}

	/**
	 * Keys reach here from clients (`finalize` only checks a prefix), so anything that could name a
	 * path outside the directory, a temp file or a sidecar is refused.
	 */
	private pathFor(key: string): string | null {
		if (key === "" || isAbsolute(key) || key.includes("\\") || key.includes("\0")) return null
		const segments = key.split("/")
		if (segments.some((segment) => segment === "" || segment.startsWith("."))) return null
		if (key.endsWith(META_SUFFIX)) return null
		const path = resolve(this.dir, key)
		if (!path.startsWith(this.dir + sep)) return null
		return path
	}

	private requirePath(key: string): string {
		const path = this.pathFor(key)
		if (path === null) throw new InvalidStorageKeyError()
		return path
	}

	private tempPath(): string {
		return join(this.tmpDir, randomUUID())
	}

	async getStream(key: string): Promise<ObjectStream> {
		const path = this.pathFor(key)
		if (path === null) throw new ObjectNotFoundError()
		let handle
		try {
			handle = await open(path, "r")
		} catch (error) {
			if (isMissing(error)) throw new ObjectNotFoundError()
			throw error
		}
		// The stream owns the handle only once created; until then a failure has to close it here.
		try {
			const stats = await handle.stat()
			if (!stats.isFile() || (await this.readMime(path)) === null) throw new ObjectNotFoundError()
			return { stream: handle.createReadStream(), contentLength: stats.size }
		} catch (error) {
			await handle.close()
			throw error
		}
	}

	async getText(key: string): Promise<string> {
		return Buffer.from(await this.get(key)).toString("utf8")
	}

	async get(key: string): Promise<Uint8Array> {
		const object = await this.getStream(key)
		const chunks: Buffer[] = []
		for await (const chunk of object.stream) chunks.push(Buffer.from(chunk as Buffer))
		return new Uint8Array(Buffer.concat(chunks))
	}

	async head(key: string): Promise<{ bytes: number; mime: string } | null> {
		const path = this.pathFor(key)
		if (path === null) return null
		let stats
		try {
			stats = await stat(path)
		} catch (error) {
			if (isMissing(error)) return null
			throw error
		}
		if (!stats.isFile()) return null
		const mime = await this.readMime(path)
		return mime === null ? null : { bytes: stats.size, mime }
	}

	/** The sidecar's mime; null for a sidecar that isn't one, which reads report as no object. */
	private async readMime(path: string): Promise<string | null> {
		let raw: string
		try {
			raw = await readFile(path + META_SUFFIX, "utf8")
		} catch (error) {
			if (isMissing(error)) return "application/octet-stream"
			throw error
		}
		let parsed: unknown
		try {
			parsed = JSON.parse(raw)
		} catch {
			return null
		}
		const mime = (parsed as { mime?: unknown } | null)?.mime
		return typeof mime === "string" ? mime : null
	}

	/** Server-side copy: replaces whatever is at the key, each file atomically. */
	async put(input: { key: string; bytes: Uint8Array; mime: string }): Promise<void> {
		const path = this.requirePath(input.key)
		await mkdir(this.tmpDir, { recursive: true })
		await mkdir(dirname(path), { recursive: true })
		await this.writeAtomically(path + META_SUFFIX, JSON.stringify({ mime: input.mime }))
		await this.writeAtomically(path, input.bytes)
	}

	private async writeAtomically(path: string, data: string | Uint8Array): Promise<void> {
		const temp = this.tempPath()
		try {
			await writeFile(temp, data, { flag: "wx" })
			await rename(temp, path)
		} finally {
			await rm(temp, { force: true })
		}
	}

	async delete(key: string): Promise<void> {
		const path = this.requirePath(key)
		for (const file of [path, path + META_SUFFIX]) {
			try {
				await unlink(file)
			} catch (error) {
				if (!isMissing(error)) throw error
			}
		}
	}

	/**
	 * Keys under `prefix` whose body was last written at or after `since` and before `before`. Walks real directories and
	 * regular files only, so a symlink is never followed or listed; temp files and sidecars are skipped.
	 */
	async *listModifiedBetween(prefix: string, since: Date, before: Date): AsyncGenerator<string> {
		yield* this.keysModifiedBetween(this.requirePath(prefix), since, before)
	}

	/**
	 * Like `listModifiedBetween`, but for the store root: only directories directly under it whose name matches
	 * `dirName` are walked, so other prefixes (`artifacts/`, `.tmp`, probe files) are never descended into.
	 */
	async *listRootModifiedBetween(dirName: RegExp, since: Date, before: Date): AsyncGenerator<string> {
		let entries
		try {
			entries = await readdir(this.dir, { withFileTypes: true })
		} catch (error) {
			if (isMissing(error)) return
			throw error
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith(".") || !dirName.test(entry.name)) continue
			yield* this.keysModifiedBetween(join(this.dir, entry.name), since, before)
		}
	}

	private async *keysModifiedBetween(root: string, since: Date, before: Date): AsyncGenerator<string> {
		for await (const path of walkFiles(root)) {
			const key = path
				.slice(this.dir.length + 1)
				.split(sep)
				.join("/")
			if (key.endsWith(META_SUFFIX) || this.pathFor(key) === null) continue
			const modified = await modifiedAt(path)
			if (modified !== null && modified >= since && modified < before) yield key
		}
	}

	/** Deletes temp files last written before `before`: what a crashed upload leaves behind. */
	async deleteTempOlderThan(before: Date): Promise<number> {
		let deleted = 0
		for await (const path of walkFiles(this.tmpDir)) {
			const modified = await modifiedAt(path)
			if (modified === null || modified >= before) continue
			await rm(path, { force: true })
			deleted++
		}
		return deleted
	}

	/**
	 * Deletes sidecars whose body doesn't exist and that were last written before `before`, under `artifacts/` and the
	 * root directories matching `dirName`: what a crash between `writeUpload`'s two links leaves. Takes no database
	 * lock: a Revision can't reference a key without a body (finalize checks `exists()` under its lock), and a sidecar
	 * older than `before` (the orphan cutoff, longer than any ticket) has no upload still able to link its body.
	 */
	async deleteOrphanSidecarsOlderThan(dirName: RegExp, before: Date): Promise<number> {
		const roots = [join(this.dir, "artifacts")]
		try {
			for (const entry of await readdir(this.dir, { withFileTypes: true })) {
				if (entry.isDirectory() && !entry.name.startsWith(".") && dirName.test(entry.name)) {
					roots.push(join(this.dir, entry.name))
				}
			}
		} catch (error) {
			if (!isMissing(error)) throw error
		}
		let deleted = 0
		for (const root of roots) {
			for await (const path of walkFiles(root)) {
				if (!path.endsWith(META_SUFFIX)) continue
				const modified = await modifiedAt(path)
				if (modified === null || modified >= before) continue
				if ((await modifiedAt(path.slice(0, -META_SUFFIX.length))) !== null) continue
				await rm(path, { force: true })
				deleted++
			}
		}
		return deleted
	}

	/**
	 * A client upload: stores `source` only if it is exactly `bytes` long, and never over an existing
	 * object, so a replayed ticket can't swap the bytes under a Revision that already settled. The
	 * source is never destroyed here, so the caller can still answer on its connection.
	 */
	async writeUpload(key: string, source: Readable, expected: { mime: string; bytes: number }): Promise<void> {
		const path = this.requirePath(key)
		await mkdir(this.tmpDir, { recursive: true })
		const tempBody = this.tempPath()
		try {
			await receive(source, tempBody, expected.bytes, this.uploadIdleMs)
			await mkdir(dirname(path), { recursive: true })
			// The sidecar is claimed first and exclusively too, so a replay can't rewrite it either.
			await this.linkNew(JSON.stringify({ mime: expected.mime }), path + META_SUFFIX)
			try {
				await linkExclusive(tempBody, path)
			} catch (error) {
				// The sidecar is ours by now; without a body it would answer for whoever uploads next.
				if (!(error instanceof ObjectExistsError)) await rm(path + META_SUFFIX, { force: true })
				throw error
			}
		} finally {
			await rm(tempBody, { force: true })
		}
	}

	private async linkNew(data: string, path: string): Promise<void> {
		const temp = this.tempPath()
		try {
			await writeFile(temp, data, { flag: "wx" })
			await linkExclusive(temp, path)
		} finally {
			await rm(temp, { force: true })
		}
	}
}

/** Regular files under `dir`, depth first; dot-entries and anything that isn't a real file or directory are skipped. */
async function* walkFiles(dir: string): AsyncGenerator<string> {
	let entries
	try {
		entries = await readdir(dir, { withFileTypes: true })
	} catch (error) {
		if (isMissing(error)) return
		throw error
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue
		const path = join(dir, entry.name)
		if (entry.isDirectory()) yield* walkFiles(path)
		else if (entry.isFile()) yield path
	}
}

async function modifiedAt(path: string): Promise<Date | null> {
	try {
		const stats = await lstat(path)
		return stats.isFile() ? stats.mtime : null
	} catch (error) {
		if (isMissing(error)) return null
		throw error
	}
}

async function linkExclusive(from: string, to: string): Promise<void> {
	try {
		await link(from, to)
	} catch (error) {
		if ((error as { code?: string })?.code === "EEXIST") throw new ObjectExistsError()
		throw error
	}
}

async function receive(source: Readable, temp: string, bytes: number, idleMs: number): Promise<void> {
	if (source.destroyed && !source.readableEnded) throw new Error("upload source closed before it ended")
	let received = 0
	let idle: NodeJS.Timeout | undefined
	const armIdle = () => {
		clearTimeout(idle)
		idle = setTimeout(() => counter.destroy(new UploadIdleTimeoutError()), idleMs)
	}
	const counter = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			armIdle()
			received += chunk.length
			if (received > bytes) callback(new UploadSizeMismatchError())
			else callback(null, chunk)
		},
	})
	// `pipe`, not `pipeline`, from the source: a failure unpipes it instead of destroying it.
	const onError = (error: Error) => counter.destroy(error)
	const onClose = () => {
		if (!source.readableEnded) counter.destroy(new Error("upload source closed before it ended"))
	}
	source.once("error", onError)
	source.once("close", onClose)
	source.pipe(counter)
	armIdle()
	try {
		await pipeline(counter, createWriteStream(temp, { flags: "wx" }))
	} finally {
		clearTimeout(idle)
		source.off("error", onError)
		source.off("close", onClose)
		source.unpipe(counter)
	}
	if (received !== bytes) throw new UploadSizeMismatchError()
}
