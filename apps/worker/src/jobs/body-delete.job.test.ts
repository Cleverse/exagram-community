import { describe, expect, it } from "vitest"

import { createBodyDeleteHandler, type BodyDeleteDeps } from "./body-delete.job"

function fakes(referenced: string[]) {
	const calls: string[] = []
	let open = false
	const deps: BodyDeleteDeps = {
		store: {
			delete(key) {
				calls.push(`delete ${key} ${open ? "locked" : "unlocked"}`)
				return Promise.resolve()
			},
		},
		revisions: {
			lockStorageKey(key) {
				calls.push(`lock ${key}`)
				return Promise.resolve()
			},
			storageKeysInUse(keys) {
				return Promise.resolve(new Set(keys.filter((key) => referenced.includes(key))))
			},
		},
		tx: {
			async atomic(fn) {
				open = true
				try {
					return await fn()
				} finally {
					open = false
				}
			},
		},
	}
	return { deps, calls }
}

describe("body-delete", () => {
	it("deletes only bodies no Revision still names, under each key's lock", async () => {
		const { deps, calls } = fakes(["bodies/shared"])
		await createBodyDeleteHandler(deps)({ storageKeys: ["bodies/b", "bodies/shared", "artifacts/a/x", "bodies/b"] })
		expect(calls).toEqual([
			"lock artifacts/a/x",
			"lock bodies/b",
			"lock bodies/shared",
			"delete artifacts/a/x locked",
			"delete bodies/b locked",
		])
	})
})
