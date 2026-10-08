import { ANYONE_PASSWORD_MAX } from "@exagram/api-client"
import clsx from "clsx"
import { type ReactNode, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/Button"
import { IconButton } from "@/components/ui/IconButton"
import { IconClose, IconEye, IconEyeOff, IconLock, IconRefresh, IconSlidersHorizontal } from "@/components/ui/icons"
import { menuPosition } from "@/components/ui/menuPosition"
import { Switch } from "@/components/ui/Switch"
import {
	type AnyoneSettingsModel,
	CURRENT_EXPIRY,
	EXPIRY_OPTIONS,
	type ExpiryValue,
} from "@/features/grants/useAnyoneSettings"
import { formatDay } from "@/utils/format"
import { useEscapeClaim } from "@/utils/useEscapeClaim"

const ARRIVE = "fadeUp 200ms var(--ease-arrive)"

/** A setting: its name and what it does on the left, its control on the right. */
const Row = ({ title, helper, children }: { title: string; helper: string; children: ReactNode }) => (
	<div className="flex items-center" style={{ gap: 16 }}>
		<div className="min-w-0 flex-1">
			<div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
			<div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>
				{helper}
			</div>
		</div>
		{children}
	</div>
)

const expiryHelper = (anyone: AnyoneSettingsModel) => {
	if (anyone.expiresAt === null) return "The link works until you change access."
	if (anyone.expired) return "This link has expired. Pick a new time to open it again."
	return `The link stops working on ${formatDay(anyone.expiresAt)}${anyone.passwordOn ? ", even with the password" : ""}.`
}

/**
 * Require password, Link expires and Allow download (ADR 0044), one layout for the desktop popover and the phone's
 * drawer step. `touch` sizes the controls for a thumb and keeps text at 16px so iOS does not zoom on focus.
 * `onPreview` runs once "Preview as recipient" has opened the gate.
 */
export const AnyoneSettingsControls = ({
	anyone,
	touch = false,
	onPreview,
}: {
	anyone: AnyoneSettingsModel
	touch?: boolean
	onPreview?: () => void
}) => {
	const { password } = anyone
	const height = touch ? 44 : 40

	return (
		<>
			<div>
				<Row
					title="Require password"
					helper={
						anyone.passwordOn
							? "People must enter the password to open the link."
							: "Add a password for extra protection."
					}
				>
					<Switch label="Require password" checked={anyone.passwordOn} onChange={anyone.setPasswordOn} />
				</Row>
				{anyone.passwordOn ? (
					<>
						<div className="flex items-center" style={{ gap: 8, marginTop: 10, animation: ARRIVE }}>
							<div
								className="flex min-w-0 flex-1 items-center bg-panel has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ink"
								style={{
									height,
									padding: "0 4px 0 12px",
									border: "1px solid var(--color-line-segment)",
									borderRadius: 8,
								}}
							>
								<input
									aria-label="Password"
									type={password.revealed ? "text" : "password"}
									value={password.value}
									placeholder={password.placeholder}
									maxLength={ANYONE_PASSWORD_MAX}
									spellCheck={false}
									autoComplete="off"
									data-1p-ignore
									aria-invalid={password.tooShort}
									onChange={(event) => anyone.typePassword(event.target.value)}
									onBlur={anyone.commitTyped}
									onKeyDown={(event) => {
										if (event.key !== "Enter") return
										event.preventDefault()
										anyone.commitTyped()
									}}
									title={password.placeholder}
									className="min-w-0 flex-1 truncate border-0 bg-transparent text-ink outline-none placeholder:font-sans placeholder:text-[13px] placeholder:tracking-normal"
									style={{ fontFamily: "var(--font-mono)", fontSize: touch ? 16 : 14, letterSpacing: ".04em" }}
								/>
								<IconButton
									size={32}
									aria-label={password.revealed ? "Hide password" : "Show password"}
									title={password.revealed ? "Hide password" : "Show password"}
									onClick={anyone.toggleReveal}
								>
									{password.revealed ? <IconEyeOff size={16} /> : <IconEye size={16} />}
								</IconButton>
								<IconButton
									size={32}
									aria-label="Generate new password"
									title="Generate new password"
									disabled={anyone.saving}
									onClick={anyone.generate}
								>
									<IconRefresh size={16} />
								</IconButton>
							</div>
							<Button
								variant="outline"
								size={40}
								disabled={!password.canCopy}
								onClick={anyone.copyPassword}
								className="whitespace-nowrap"
								style={{ height, padding: "0 14px", fontSize: 14, fontWeight: 600, borderRadius: 8 }}
							>
								Copy password
							</Button>
						</div>
						{password.tooShort ? (
							<p role="alert" className="m-0 text-danger" style={{ fontSize: 13, marginTop: 6 }}>
								Use at least 8 characters.
							</p>
						) : null}
					</>
				) : null}
			</div>

			<Row title="Link expires" helper={expiryHelper(anyone)}>
				<select
					aria-label="Link expires"
					value={anyone.expiry}
					onChange={(event) => anyone.setExpiry(event.target.value as ExpiryValue)}
					className="flex-none bg-panel text-ink"
					style={{
						height: touch ? 44 : 36,
						padding: "0 10px",
						border: "1px solid var(--color-line-segment)",
						borderRadius: 8,
						fontSize: touch ? 16 : 14,
					}}
				>
					{anyone.expiresAt === null ? null : (
						<option value={CURRENT_EXPIRY}>
							{anyone.expired ? "Expired" : `Expires ${formatDay(anyone.expiresAt)}`}
						</option>
					)}
					{EXPIRY_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</Row>

			<Row
				title="Allow download"
				helper={anyone.download ? "Recipients can view and download." : "Recipients can view only."}
			>
				<Switch label="Allow download" checked={anyone.download} onChange={anyone.setDownload} />
			</Row>

			{anyone.passwordOn ? (
				<div
					className="flex items-center justify-between border-t border-pane-line"
					style={{ gap: 12, paddingTop: 12 }}
				>
					<div className="text-muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
						Send the password separately from the link.
					</div>
					<button
						type="button"
						className="flex-none whitespace-nowrap hover:text-link-hover"
						style={{
							minHeight: touch ? 44 : undefined,
							fontSize: 14,
							fontWeight: 600,
							textDecoration: "underline",
							textUnderlineOffset: 3,
						}}
						onClick={() => {
							if (anyone.startPreview()) onPreview?.()
						}}
					>
						Preview as recipient
					</button>
				</div>
			) : null}

			{anyone.error ? (
				<p role="alert" className="m-0 text-danger" style={{ fontSize: 13 }}>
					{anyone.error}
				</p>
			) : null}
		</>
	)
}

/**
 * General access's Link settings button and its popover (ADR 0044). The popover opens upward from the button, as
 * the row sits at the foot of the dialog, and is fixed to the window so the dialog's scrolling middle cannot cut
 * it off. Escape and a click outside close it; the Share dialog stays.
 */
export const AnyoneSettingsPopover = ({ anyone }: { anyone: AnyoneSettingsModel }) => {
	// The button's rect while open, null while closed.
	const [anchor, setAnchor] = useState<DOMRect | null>(null)
	const wrapRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const open = anchor !== null
	const close = () => setAnchor(null)

	useEffect(() => {
		if (!open) return
		const onDown = (event: MouseEvent) => {
			if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setAnchor(null)
		}
		// The dialog's middle scrolls under a fixed popover, so it follows its button.
		const follow = () => setAnchor(triggerRef.current?.getBoundingClientRect() ?? null)
		document.addEventListener("mousedown", onDown)
		window.addEventListener("resize", follow)
		document.addEventListener("scroll", follow, true)
		return () => {
			document.removeEventListener("mousedown", onDown)
			window.removeEventListener("resize", follow)
			document.removeEventListener("scroll", follow, true)
		}
	}, [open])

	useEscapeClaim(open, () => {
		close()
		triggerRef.current?.focus()
	})

	// Leaving the recipient preview puts focus back on the button the Owner started from.
	const wasPreviewing = useRef(false)
	useEffect(() => {
		if (wasPreviewing.current && !anyone.previewing) triggerRef.current?.focus()
		wasPreviewing.current = anyone.previewing
	}, [anyone.previewing])

	const width = Math.min(400, window.innerWidth - 96)
	const placed = anchor
		? menuPosition({ top: anchor.top, bottom: anchor.bottom, left: anchor.right - width }, "up", width, {
				width: window.innerWidth,
				height: window.innerHeight,
			})
		: null
	// The popover may use all the room on its side, not the menu's 60% of the window: cut short, its footer is lost.
	const position =
		anchor && placed
			? { ...placed, maxHeight: "bottom" in placed ? anchor.top - 14 : window.innerHeight - anchor.bottom - 14 }
			: null

	return (
		<div ref={wrapRef} className="flex-none">
			<button
				ref={triggerRef}
				type="button"
				aria-expanded={open}
				aria-haspopup="dialog"
				onClick={(event) => setAnchor(open ? null : event.currentTarget.getBoundingClientRect())}
				className={clsx(
					"press flex items-center whitespace-nowrap text-ink",
					open ? "bg-row-selected" : "bg-panel hover:bg-ground",
				)}
				style={{
					gap: 6,
					height: 32,
					padding: "0 10px",
					border: "1px solid var(--color-line-segment)",
					borderRadius: 8,
					fontSize: 14,
					fontWeight: 600,
				}}
			>
				<IconSlidersHorizontal size={15} />
				Link settings
				{anyone.passwordOn ? (
					<>
						<IconLock size={13} className="text-secondary" />
						<span className="sr-only">Password on</span>
					</>
				) : null}
			</button>
			{position ? (
				<div
					role="dialog"
					aria-label="Link settings"
					tabIndex={-1}
					className="fixed flex flex-col bg-panel outline-none"
					style={{
						...position,
						zIndex: 6,
						width,
						gap: 14,
						padding: 16,
						overflowY: "auto",
						border: "1px solid var(--color-line-soft)",
						borderRadius: 12,
						boxShadow: "var(--shadow-menu)",
						animation: ARRIVE,
					}}
				>
					<div className="flex items-center" style={{ gap: 8 }}>
						<div className="font-display flex-1" style={{ fontWeight: 600, fontSize: 15 }}>
							Link settings
						</div>
						<IconButton size={32} aria-label="Close" title="Close" onClick={close} style={{ margin: -4 }}>
							<IconClose size={14} />
						</IconButton>
					</div>
					<AnyoneSettingsControls anyone={anyone} onPreview={close} />
				</div>
			) : null}
		</div>
	)
}
