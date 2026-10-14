import { describe, expect, it } from "vitest"

import { edition as communityEdition } from "@/edition/edition"
import { visibleSettingsTabs } from "@/features/settings/settingsTabs"

describe("visibleSettingsTabs, community", () => {
	it("has Team and Audit but no Security or Notifications tab, whatever the server says", () => {
		expect(visibleSettingsTabs(communityEdition, { redaction: true, kind: "team" })).toEqual([
			"general",
			"team",
			"audit",
		])
	})

	it("a Personal Workspace leaves Team and Audit out", () => {
		expect(visibleSettingsTabs(communityEdition, { redaction: false, kind: "personal" })).toEqual(["general"])
	})

	it("offers nothing before the kind is known, so Team tabs never show on a Personal session", () => {
		expect(visibleSettingsTabs(communityEdition, { redaction: true, kind: undefined })).toEqual([])
	})
})
