import { type AnyoneSettings, type VisibleArtifact } from "@exagram/api-client"
import { vi } from "vitest"

import { apiClient } from "@/config/apiClient"

export const anyoneSettings = (over: Partial<AnyoneSettings> = {}): AnyoneSettings => ({
	passwordOn: false,
	passwordSet: false,
	expiresAt: null,
	download: true,
	...over,
})

/**
 * What `setAnyoneSettings` does on the server, as far as a screen can tell: each field that is sent changes, a
 * password makes `passwordSet`, and `expiresInDays` becomes a date. It answers with the whole Artifact.
 */
export const fakeAnyoneServer = (start: VisibleArtifact) => {
	let current = start
	return vi.spyOn(apiClient.artifacts, "setAnyoneSettings").mockImplementation((patch) => {
		const before = current.anyoneSettings
		if (!before) return Promise.reject(new Error("not the Owner"))
		current = {
			...current,
			anyoneSettings: {
				passwordOn: patch.passwordOn ?? before.passwordOn,
				passwordSet: before.passwordSet || patch.password !== undefined,
				expiresAt:
					patch.expiresInDays === undefined
						? before.expiresAt
						: patch.expiresInDays === null
							? null
							: new Date(Date.now() + patch.expiresInDays * 86_400_000),
				download: patch.download ?? before.download,
			},
		}
		return Promise.resolve(current)
	})
}
