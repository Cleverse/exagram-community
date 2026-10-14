import { describe, expect, it, vi } from "vitest"

import { composePreviewMenuItems, type DockedMenu } from "./previewMenu"

import { type MenuItem } from "@/components/ui/Menu"

const pinItem: MenuItem = { label: "Pin for org", onSelect: vi.fn() }
const items: MenuItem[] = [
	{ label: "Tags…", onSelect: vi.fn() },
	pinItem,
	{ label: "Move to folder…", onSelect: vi.fn() },
]
const deleteItem: MenuItem = { label: "Delete this file", dividerAbove: true, onSelect: vi.fn() }

const base = {
	items,
	pinItem,
	deleteItem,
	docked: null,
	isOwner: true,
	viewAsAi: false,
	redactionEnabled: true,
	onLinks: vi.fn(),
	onRedaction: vi.fn(),
	onViewAsAi: vi.fn(),
	onComments: vi.fn(),
	onLedger: vi.fn(),
}

const docked = (over: Partial<DockedMenu> = {}): DockedMenu => ({
	onPresent: vi.fn(),
	onCopyLink: vi.fn(),
	isPinned: false,
	onTogglePin: vi.fn(),
	...over,
})

const labels = (composed: MenuItem[]) => composed.map((item) => item.label)

describe("composePreviewMenuItems", () => {
	it("orders …Move project, Links…, Redaction…, View as AI, Comments, Ledger, then Delete last for an owner", () => {
		expect(labels(composePreviewMenuItems(base))).toEqual([
			"Tags…",
			"Pin for org",
			"Move to folder…",
			"Links…",
			"Redaction…",
			"View as AI",
			"Comments",
			"Ledger",
			"Delete this file",
		])
	})

	it("drops Links, the AI group and Ledger for a non-owner but still puts Delete last", () => {
		expect(labels(composePreviewMenuItems({ ...base, isOwner: false }))).toEqual([
			"Tags…",
			"Pin for org",
			"Move to folder…",
			"Comments",
			"Delete this file",
		])
	})

	it("omits Delete when there is no deleteItem", () => {
		expect(labels(composePreviewMenuItems({ ...base, deleteItem: null }))).not.toContain("Delete this file")
	})

	it("relabels the View as AI item while the AI view is on", () => {
		expect(labels(composePreviewMenuItems({ ...base, viewAsAi: true }))).toContain("Exit AI view")
	})

	it("drops Redaction… and View as AI, keeping the rest, when redaction is switched off", () => {
		expect(labels(composePreviewMenuItems({ ...base, redactionEnabled: false }))).toEqual([
			"Tags…",
			"Pin for org",
			"Move to folder…",
			"Links…",
			"Comments",
			"Ledger",
			"Delete this file",
		])
	})

	it("leads the docked menu with Present, Copy link and Pin, in place of Pin for org", () => {
		expect(labels(composePreviewMenuItems({ ...base, isOwner: false, docked: docked() }))).toEqual([
			"Present",
			"Copy link",
			"Pin",
			"Tags…",
			"Move to folder…",
			"Comments",
			"Delete this file",
		])
	})

	it("leaves Present out of the docked menu while the header shows its button", () => {
		const composed = composePreviewMenuItems({ ...base, docked: docked({ onPresent: null }) })
		expect(labels(composed).slice(0, 2)).toEqual(["Copy link", "Pin"])
		expect(labels(composed)).not.toContain("Present")
	})

	it("offers Unpin for a pinned file and wires each docked item to its action", () => {
		const menu = docked({ isPinned: true })
		const composed = composePreviewMenuItems({ ...base, docked: menu })
		const select = (label: string) => composed.find((item) => item.label === label)?.onSelect()
		expect(labels(composed)).not.toContain("Pin")
		select("Present")
		select("Copy link")
		select("Unpin")
		expect(menu.onPresent).toHaveBeenCalledOnce()
		expect(menu.onCopyLink).toHaveBeenCalledOnce()
		expect(menu.onTogglePin).toHaveBeenCalledOnce()
	})
})
