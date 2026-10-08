import { describe, expect, it } from "vitest"

import { edition as communityEdition } from "@/edition/edition"
import { visibleSettingsTabs } from "@/features/settings/settingsTabs"

describe("visibleSettingsTabs, community", () => {
	it("has Team and Audit but no Security tab, whatever the server says", () => {
		expect(visibleSettingsTabs(communityEdition, { redaction: true, kind: "team" })).toEqual([
			"general",
			"team",
			"audit",
			"notifications",
		])
	})

	it("a Personal Workspace leaves Team and Audit out", () => {
		expect(visibleSettingsTabs(communityEdition, { redaction: false, kind: "personal" })).toEqual([
			"general",
			"notifications",
		])
	})
})
