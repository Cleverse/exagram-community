import clsx from "clsx"
import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useRef } from "react"

import { IconCheck, IconChevronLeft, IconChevronRight } from "./icons"
import { menuPosition } from "./menuPosition"

/** The items the arrows walk: a disabled one is read in place but never landed on. */
const ENABLED_ITEM = '[role^="menuitem"]:not([aria-disabled="true"])'

export type MenuItem = {
	label: string
	onSelect: () => void
	href?: string
	color?: string
	/** A 17px glyph in front of the label; the pane's ⋯ menu carries one per item. */
	icon?: ReactNode
	/** Draws a rule above this item — the pane menu separates "Delete this file" this way. */
	dividerAbove?: boolean
	/**
	 * Marks one choice of a set as the current one (the move menu's present folder): bold, a trailing check,
	 * and `menuitemradio` with `aria-checked` so the state is announced. Items of that set pass `false`.
	 */
	checked?: boolean
	/** Sets a subordinate choice in under its parent, as the move menu does a folder under its project. */
	indent?: boolean
	/** A 13px muted value after the label that truncates first (the account menu's current organization). */
	detail?: string
	/** A trailing ›: the item swaps the menu's contents for a sub-list rather than acting. */
	chevron?: boolean
	/** A leading ‹: the item returns from a sub-list to the list it came from. */
	back?: boolean
	/**
	 * Offered but not selectable (the Workspace choice of General access without an Allowed Domain): dimmed,
	 * `aria-disabled`, skipped by the arrows, and `onSelect` never fires. It stays in the tab order so a
	 * screen reader can read why it is there.
	 */
	disabled?: boolean
}

/**
 * The ROW MENU popover (T:L3277–3285): a full-screen click-catcher plus a 240px card that scrolls when it
 * runs out of room. `anchor` is the trigger's bounding rect; `menuPosition` places the card. By default it
 * opens below the trigger; `placement="up"` prefers above, for a trigger at the foot of the screen (the
 * account menu).
 *
 * Keyboard follows the ARIA menu pattern: opening moves focus to the first item, Arrow Up/Down wrap
 * through the items, Home and End jump to the ends, Escape closes, and closing hands focus back to
 * whatever held it when the menu opened (the trigger).
 *
 * A menu whose contents swap in place (the account menu's organization list) passes a `view` that names
 * the list on show: each change moves focus to the new list's first item. `onEscape` then lets Escape
 * step back out of the sub-list instead of closing.
 */
export const Menu = ({
	anchor,
	items,
	onClose,
	header,
	ariaLabel,
	placement = "down",
	width = 240,
	view,
	onEscape,
	footer,
}: {
	anchor: DOMRect
	items: MenuItem[]
	onClose: () => void
	/** Non-interactive content above the items (e.g. the signed-in email in the account menu). */
	header?: ReactNode
	/** Non-interactive content below the items (General access's note on what the link lets in). */
	footer?: ReactNode
	ariaLabel?: string
	placement?: "down" | "up"
	width?: number
	view?: string
	/** Escape's action; closing by default. */
	onEscape?: () => void
}) => {
	const cardRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") return
			// Claimed, so a window-level Escape (the preview's full view, the pane) leaves it alone.
			event.preventDefault()
			const handle = onEscape ?? onClose
			handle()
		}
		document.addEventListener("keydown", onKeyDown)
		return () => document.removeEventListener("keydown", onKeyDown)
	}, [onClose, onEscape])

	useEffect(() => {
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
		return () => {
			if (opener?.isConnected) opener.focus()
		}
	}, [])

	// On open, and whenever the contents swap, focus lands on the first item of the list on show.
	useEffect(() => {
		cardRef.current?.querySelector<HTMLElement>(ENABLED_ITEM)?.focus()
	}, [view])

	const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const menuItems = [...event.currentTarget.querySelectorAll<HTMLElement>(ENABLED_ITEM)]
		if (menuItems.length === 0) return
		const index = menuItems.indexOf(document.activeElement as HTMLElement)
		const next =
			event.key === "ArrowDown"
				? (index + 1) % menuItems.length
				: event.key === "ArrowUp"
					? (index - 1 + menuItems.length) % menuItems.length
					: event.key === "Home"
						? 0
						: event.key === "End"
							? menuItems.length - 1
							: null
		if (next === null) return
		event.preventDefault()
		menuItems[next]?.focus()
	}

	const position = menuPosition(anchor, placement, width, { width: window.innerWidth, height: window.innerHeight })

	return (
		<>
			<div onClick={onClose} className="fixed inset-0" style={{ zIndex: 40 }} />
			<div
				ref={cardRef}
				role="menu"
				aria-label={ariaLabel}
				onKeyDown={onMenuKeyDown}
				className="fixed"
				style={{
					zIndex: 41,
					...position,
					width,
					overflowY: "auto",
					background: "var(--color-panel)",
					border: "1px solid var(--color-line-soft)",
					borderRadius: "var(--radius)",
					boxShadow: "var(--shadow-menu)",
					padding: 6,
					animation: "fadeUp var(--duration-panel) var(--ease-arrive)",
				}}
			>
				{header}
				{items.map((item, index) => {
					// The current choice of a set sits on the selected-row fill, as a selected list row does.
					const className = clsx(
						"flex w-full items-center text-left transition-colors duration-(--duration-row) ease-(--ease-arrive)",
						item.disabled ? "cursor-default" : "hover:bg-menu-hover",
						item.checked && "bg-row-selected",
					)
					const style = {
						// A row with a detail or a chevron sits tighter, as the account menu's does (P:2978).
						gap: item.detail !== undefined || item.chevron || item.back ? 8 : 12,
						padding: item.indent ? "10px 12px 10px 32px" : "10px 12px",
						fontSize: 15,
						fontWeight: item.checked ? 700 : undefined,
						color: item.disabled
							? "var(--color-muted-2)"
							: (item.color ?? (item.indent ? "var(--color-secondary)" : "var(--color-ink)")),
					}
					const role = item.checked === undefined ? "menuitem" : "menuitemradio"
					const onClick = item.disabled ? undefined : item.onSelect
					// The label and its detail are adjacent spans, so name them with a pause between.
					const name = item.detail === undefined ? undefined : `${item.label}, ${item.detail}`
					const content = (
						<>
							{item.back ? <IconChevronLeft size={15} className="flex-none" /> : null}
							{item.icon ? (
								<span
									className="grid flex-none place-items-center"
									style={{ width: 17, color: item.color ?? "var(--color-secondary)" }}
								>
									{item.icon}
								</span>
							) : null}
							{item.detail === undefined ? (
								<span className="min-w-0 flex-1">{item.label}</span>
							) : (
								<>
									<span className="flex-[1_0_auto] whitespace-nowrap">{item.label}</span>
									<span className="min-w-0 flex-[0_1_auto] truncate text-muted" style={{ fontSize: 13 }}>
										{item.detail}
									</span>
								</>
							)}
							{item.chevron ? <IconChevronRight size={15} className="flex-none text-muted" /> : null}
							{item.checked ? <IconCheck size={14} className="flex-none text-ink" /> : null}
						</>
					)
					return (
						// Labels can repeat (two projects may each hold a folder of the same name), so the index is in the key.
						<Fragment key={`${index}:${item.label}`}>
							{item.dividerAbove ? (
								<div role="separator" style={{ height: 1, background: "var(--color-row-line)", margin: "6px 8px" }} />
							) : null}
							{item.href ? (
								<a
									href={item.href}
									role={role}
									aria-checked={item.checked}
									aria-disabled={item.disabled || undefined}
									aria-label={name}
									onClick={onClick}
									className={className}
									style={style}
								>
									{content}
								</a>
							) : (
								<button
									type="button"
									role={role}
									aria-checked={item.checked}
									aria-disabled={item.disabled || undefined}
									aria-label={name}
									onClick={onClick}
									className={className}
									style={style}
								>
									{content}
								</button>
							)}
						</Fragment>
					)
				})}
				{footer}
			</div>
		</>
	)
}
