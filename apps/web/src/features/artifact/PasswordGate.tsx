import { type AnyoneGate, anyoneGateOf, isIncorrectPassword, statusOf } from "@exagram/api-client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, type ReactNode, useId, useState } from "react"
import { createPortal } from "react-dom"

import { useShell } from "@/components/mobile/shell"
import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/Button"
import { IconClock, IconLock } from "@/components/ui/icons"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { FULL_VIEW_LAYER } from "@/features/library/paneLayout"
import { useEscapeClaim } from "@/utils/useEscapeClaim"

const EMPTY = "Enter the password."
const INCORRECT = "Incorrect password. Try again."

/**
 * What a reader meets before a password-protected file (ADR 0044): a bar with the wordmark and a centred card.
 * Without `layer` it fills the page it sits on; with one it covers the window, as the Owner's recipient preview
 * and the signed-in page do. `preview` adds the Owner-only label and Exit button; the real gate has neither.
 */
export const GateScreen = ({
	layer,
	preview,
	children,
}: {
	layer?: number
	preview?: { onExit: () => void }
	children: ReactNode
}) => (
	<div
		className="flex flex-col overflow-auto bg-surface"
		style={layer === undefined ? { minHeight: "100dvh" } : { position: "fixed", inset: 0, zIndex: layer }}
	>
		<header
			className="box-border flex flex-none items-center border-b border-pane-line bg-panel"
			style={{ height: "calc(52px + env(safe-area-inset-top))", padding: "env(safe-area-inset-top) 20px 0", gap: 12 }}
		>
			<div className="flex-1" style={{ fontWeight: 700, fontSize: 16 }}>
				Exagram
			</div>
			{preview ? (
				<>
					<span className="text-muted" style={{ fontSize: 13 }}>
						Recipient preview
					</span>
					<Button variant="outline" size={32} onClick={preview.onExit}>
						Exit preview
					</Button>
				</>
			) : null}
		</header>
		<GateBody>{children}</GateBody>
	</div>
)

/** The card's centred stage, for a screen that already has its own bar (the phone's pushed header). */
export const GateBody = ({ children }: { children: ReactNode }) => (
	<main className="grid flex-1 place-items-center" style={{ minHeight: "100%", padding: "40px 24px" }}>
		{children}
	</main>
)

const GateCard = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
	<div
		className="w-full bg-panel"
		style={{
			maxWidth: 400,
			padding: 32,
			border: "1px solid var(--color-line-soft)",
			borderRadius: 16,
			boxShadow: "var(--shadow-sheet)",
			animation: "fadeUp var(--duration-panel) var(--ease-arrive)",
		}}
	>
		<div className="grid place-items-center bg-subtle text-ink" style={{ width: 44, height: 44, borderRadius: "50%" }}>
			{icon}
		</div>
		{children}
	</div>
)

const GateTitle = ({ children }: { children: ReactNode }) => (
	<h1 className="font-display m-0" style={{ fontWeight: 600, fontSize: 22, letterSpacing: "-.01em", marginTop: 18 }}>
		{children}
	</h1>
)

/**
 * The lock and a password field, nothing about the file: the server tells this reader no title, owner or kind
 * (ADR 0044). A right password sets the unlock cookie and refetches the Artifact; a wrong one stays here with its
 * error, which typing clears. In `preview` the Owner is trying their own password, so a right one ends the preview.
 */
export const PasswordGate = ({ artifactId, preview }: { artifactId: string; preview?: { onExit: () => void } }) => {
	const toast = useToast()
	const queryClient = useQueryClient()
	const phone = useShell() === "mobile"
	const errorId = useId()
	const [password, setPassword] = useState("")
	const [error, setError] = useState<string | null>(null)

	const unlock = useMutation({
		mutationFn: async () => {
			await apiClient.artifacts.unlock({ artifactId, password })
			// Held until the page has asked again, so the button reads "Opening…" until the file replaces the gate.
			if (!preview) await queryClient.invalidateQueries({ queryKey: QueryKeys.artifacts.get(artifactId) })
		},
		onSuccess: () => {
			if (preview) {
				preview.onExit()
				toast("Password works.")
			} else if (anyoneGateOf(queryClient.getQueryState(QueryKeys.artifacts.get(artifactId))?.error) === "password") {
				// The password was right but the file still says no: the browser did not keep the cookie it was given.
				setError("Could not open this file. Check that your browser allows cookies.")
			} else {
				toast("Unlocked.")
			}
		},
		onError: (failure) => {
			setError(isIncorrectPassword(failure) ? INCORRECT : failure.message)
			// No live password any more (the Owner switched it off): the page asks again and shows what is there now.
			if (statusOf(failure) === 404)
				void queryClient.invalidateQueries({ queryKey: QueryKeys.artifacts.get(artifactId) })
		},
	})

	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (unlock.isPending) return
		if (password === "") return setError(EMPTY)
		unlock.mutate()
	}

	return (
		<GateCard icon={<IconLock size={20} strokeWidth={1.8} />}>
			<GateTitle>Enter password to open</GateTitle>
			<form onSubmit={submit} noValidate style={{ marginTop: 20 }}>
				<input
					type="password"
					aria-label="Password"
					placeholder="Password"
					value={password}
					autoFocus
					// A shared secret, not the reader's own login: no password manager should offer one here.
					autoComplete="off"
					data-1p-ignore
					aria-invalid={error !== null}
					aria-describedby={error === null ? undefined : errorId}
					onChange={(event) => {
						setPassword(event.target.value)
						setError(null)
					}}
					className="box-border w-full bg-panel"
					style={{
						height: 44,
						padding: "0 12px",
						// 16px keeps iOS from zooming the page when the field takes focus.
						fontSize: phone ? 16 : 15,
						borderRadius: 8,
						border: `1px solid ${error === null ? "var(--color-line-segment)" : "var(--color-danger)"}`,
						transition: "border-color var(--duration-press) var(--ease-arrive)",
					}}
				/>
				{error === null ? null : (
					<p
						id={errorId}
						role="alert"
						className="m-0 text-danger"
						style={{ fontSize: 13, marginTop: 6, animation: "fadeIn 150ms var(--ease-arrive)" }}
					>
						{error}
					</p>
				)}
				<Button
					type="submit"
					size={44}
					disabled={unlock.isPending}
					style={{ width: "100%", marginTop: 14, borderRadius: 10 }}
				>
					{unlock.isPending ? "Opening…" : "Open"}
				</Button>
			</form>
			<p className="m-0 text-muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 14 }}>
				Don’t have the password? Ask the person who sent you this link.
			</p>
		</GateCard>
	)
}

/** An address that was open to Anyone with the link and has run out (ADR 0044). It says what to do, not what it was. */
export const ExpiredNotice = () => (
	<GateCard icon={<IconClock size={20} strokeWidth={1.8} />}>
		<GateTitle>This link has expired</GateTitle>
		<p className="m-0 text-muted" style={{ fontSize: 14, lineHeight: 1.5, marginTop: 6 }}>
			Ask the owner for a new one.
		</p>
	</GateCard>
)

/** What a read that stopped at a gate shows: the password prompt, or the notice that the address has run out. */
export const ReadGate = ({ gate, artifactId }: { gate: AnyoneGate; artifactId: string }) =>
	gate === "password" ? <PasswordGate artifactId={artifactId} /> : <ExpiredNotice />

/**
 * "Preview as recipient": the gate, as a recipient meets it, over the Share dialog. Open asks the server with the
 * typed password, so the Owner learns whether theirs works. Escape leaves the preview and not the dialog under it.
 */
export const RecipientPreview = ({ artifactId, onExit }: { artifactId: string; onExit: () => void }) => {
	useEscapeClaim(true, onExit)
	return createPortal(
		<div role="dialog" aria-modal="true" aria-label="Recipient preview">
			<GateScreen layer={FULL_VIEW_LAYER} preview={{ onExit }}>
				<PasswordGate artifactId={artifactId} preview={{ onExit }} />
			</GateScreen>
		</div>,
		document.body,
	)
}
