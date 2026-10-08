import { describe, expect, it } from "vitest"

import { ALLOWED_MIME_TYPES } from "../../entity/artifact"

import {
	CreateArtifactBodySchema,
	ListArtifactsQuerySchema,
	SetAnyoneSettingsBodySchema,
	UnlockBodySchema,
} from "./types"

describe("artifacts contract schemas", () => {
	it("defaults the list scope to all and leaves the filters off", () => {
		expect(ListArtifactsQuerySchema.parse({})).toEqual({ scope: "all" })
	})

	it("refuses an unsupported artifact kind and a size above the ceiling", () => {
		expect(() => ListArtifactsQuerySchema.parse({ kind: "csv" })).toThrow()
		expect(() =>
			CreateArtifactBodySchema.parse({ kind: "pdf", title: "Spec", mime: "application/pdf", bytes: 20971521 }),
		).toThrow()
	})

	it("defaults a created artifact to no project", () => {
		expect(
			CreateArtifactBodySchema.parse({ kind: "pdf", title: "Spec", mime: "application/pdf", bytes: 3 }).projectId,
		).toBeNull()
	})

	it("accepts image artifacts under the shared upload size limit", () => {
		expect(
			CreateArtifactBodySchema.parse({ kind: "image", title: "Photo", mime: "image/png", bytes: 20971520 }).kind,
		).toBe("image")
		expect(() =>
			CreateArtifactBodySchema.parse({ kind: "image", title: "Photo", mime: "image/png", bytes: 20971521 }),
		).toThrow()
	})

	it("takes any one anyone-setting alone, and keeps null for clearing the expiry", () => {
		expect(SetAnyoneSettingsBodySchema.parse({})).toEqual({})
		expect(SetAnyoneSettingsBodySchema.parse({ passwordOn: false })).toEqual({ passwordOn: false })
		expect(SetAnyoneSettingsBodySchema.parse({ expiresInDays: null })).toEqual({ expiresInDays: null })
		for (const days of [1, 7, 30])
			expect(SetAnyoneSettingsBodySchema.parse({ expiresInDays: days }).expiresInDays).toBe(days)
		expect(() => SetAnyoneSettingsBodySchema.parse({ expiresInDays: 2 })).toThrow()
	})

	it("holds a new anyone-password to 8 through 128 characters, and an unlock to 128", () => {
		expect(() => SetAnyoneSettingsBodySchema.parse({ password: "x".repeat(7) })).toThrow()
		expect(SetAnyoneSettingsBodySchema.parse({ password: "x".repeat(8) }).password).toHaveLength(8)
		expect(SetAnyoneSettingsBodySchema.parse({ password: "x".repeat(128) }).password).toHaveLength(128)
		expect(() => SetAnyoneSettingsBodySchema.parse({ password: "x".repeat(129) })).toThrow()
		expect(() => UnlockBodySchema.parse({ password: "" })).toThrow()
		expect(() => UnlockBodySchema.parse({ password: "x".repeat(129) })).toThrow()
		expect(UnlockBodySchema.parse({ password: "short" })).toEqual({ password: "short" })
	})

	it("allows CSV bytes on the existing doc kind and keeps SVG out of the image allowlist", () => {
		expect(ALLOWED_MIME_TYPES.doc.has("text/csv")).toBe(true)
		expect([...ALLOWED_MIME_TYPES.image].sort()).toEqual([
			"image/gif",
			"image/heic",
			"image/heif",
			"image/jpeg",
			"image/png",
			"image/webp",
		])
	})
})
