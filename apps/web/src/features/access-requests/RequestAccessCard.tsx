import { ACCESS_REQUEST_NOTE_MAX, type GrantRole, type WorkspaceKind } from "@exagram/api-client"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { Link } from "react-router"

import { Button } from "@/components/ui/Button"
import { IconCheck, IconLock } from "@/components/ui/icons"
import { DEFAULT_REQUEST_ROLE } from "@/features/access-requests/AccessRequests"
import { askedAgo } from "@/features/access-requests/askedAgo"
import { type SentRequest } from "@/features/access-requests/sentRequests"
import { roleHelp, roleLabel, rolesFor } from "@/features/grants/useShareModel"
import { paths } from "@/routes/paths"
import { useNow } from "@/utils/useNow"

export type RequestAccessView =
	| {
			state: "request"
			kind: WorkspaceKind
			email: string
			busy: boolean
			error: string | null
			onSend: (input: { role: GrantRole; note: string }) => void
			onSwitchAccount: () => void
	  }
	| { state: "sent" }
	| {
			state: "pending"
			sent: SentRequest
			canRemind: boolean
			busy: boolean
			error: string | null
			onRemind: () => void
			onCancel: () => void
	  }
	| { state: "approved"; title: string; ownerName: string | null; role: GrantRole; onOpen: () => void }
	| { state: "declined" }

type Of<S extends RequestAccessView["state"]> = Extract<RequestAccessView, { state: S }>

const linkClass = "press text-secondary underline decoration-line-segment underline-offset-[3px] hover:text-ink"
const linkStyle = { height: 40, padding: "0 4px", fontSize: 14 } as const
const fieldClass =
	"w-full border border-line-strong bg-panel text-ink outline-none focus:border-ink text-base sm:text-[15px]"

const useFocusWhenChanged = (state: string) => {
	const target = useRef<HTMLHeadingElement>(null)
	const previous = useRef(state)
	useEffect(() => {
		if (previous.current === state) return
		previous.current = state
		target.current?.focus()
	}, [state])
	return target
}

const Problem = ({ children }: { children: string }) => (
	<p role="alert" className="text-danger" style={{ fontSize: 13, margin: "8px 0 0" }}>
		{children}
	</p>
)

const RequestForm = ({ view: { kind, email, busy, error, onSend, onSwitchAccount } }: { view: Of<"request"> }) => {
	const [role, setRole] = useState<GrantRole>(DEFAULT_REQUEST_ROLE)
	const [note, setNote] = useState("")
	const roleId = useId()
	const helpId = useId()
	const noteId = useId()

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault()
				if (!busy) onSend({ role, note: note.trim() })
			}}
		>
			<div className="flex flex-col" style={{ gap: 6, marginTop: 24 }}>
				<label htmlFor={roleId} className="mono-label">
					Access needed
				</label>
				<select
					id={roleId}
					value={role}
					aria-describedby={helpId}
					onChange={(event) => setRole(event.target.value as GrantRole)}
					className={fieldClass}
					style={{ height: 42, padding: "0 12px" }}
				>
					{rolesFor(kind).map((option) => (
						<option key={option} value={option}>
							{roleLabel(option)}
						</option>
					))}
				</select>
				<span id={helpId} className="text-muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
					{roleHelp(kind, role)}
				</span>
			</div>
			<div className="flex flex-col" style={{ gap: 6, marginTop: 16 }}>
				<label htmlFor={noteId} className="mono-label">
					Message
				</label>
				<textarea
					id={noteId}
					rows={3}
					value={note}
					maxLength={ACCESS_REQUEST_NOTE_MAX}
					onChange={(event) => setNote(event.target.value)}
					placeholder="Add a message (optional)"
					className={fieldClass}
					style={{ padding: "10px 12px", lineHeight: 1.5, resize: "none" }}
				/>
				<span className="font-mono self-end text-muted-2" style={{ fontSize: 11.5 }}>
					{`${note.length}/${ACCESS_REQUEST_NOTE_MAX}`}
				</span>
			</div>
			{error ? <Problem>{error}</Problem> : null}
			<div className="flex items-center" style={{ gap: 12, marginTop: 24 }}>
				<Button type="submit" size={40} disabled={busy}>
					Request access
				</Button>
				<div className="flex-1" />
				<button type="button" className={linkClass} style={linkStyle} onClick={onSwitchAccount}>
					Switch account
				</button>
			</div>
			<p className="m-0 text-muted" style={{ fontSize: 14, marginTop: 14 }}>
				{`Signed in as ${email}`}
			</p>
		</form>
	)
}

const PendingActions = ({ view: { canRemind, busy, error, onRemind, onCancel } }: { view: Of<"pending"> }) => (
	<>
		<div className="flex items-center" style={{ gap: 12, marginTop: 24 }}>
			<Button variant={canRemind ? "primary" : "subtle"} size={40} disabled={!canRemind || busy} onClick={onRemind}>
				Send reminder
			</Button>
			<div className="flex-1" />
			<button type="button" className={linkClass} style={linkStyle} disabled={busy} onClick={onCancel}>
				Cancel request
			</button>
		</div>
		{canRemind ? null : (
			<p className="m-0 text-muted" style={{ fontSize: 14, marginTop: 14 }}>
				You can send a reminder after 24 hours.
			</p>
		)}
		{error ? <Problem>{error}</Problem> : null}
	</>
)

const BackToExagram = () => (
	<div style={{ marginTop: 20 }}>
		<Link to={paths.library} className={linkClass} style={{ fontSize: 14 }}>
			Back to Exagram
		</Link>
	</div>
)

type Screen = { tile: "lock" | "check" | null; title: string; lede: string; rest: ReactNode }

export const RequestAccessCard = ({ view }: { view: RequestAccessView }) => {
	const now = useNow().getTime()
	const heading = useFocusWhenChanged(view.state)

	const screen = ((): Screen => {
		switch (view.state) {
			case "request":
				return {
					tile: "lock",
					title: "You need access",
					lede: "Ask the owner for access to this file.",
					rest: <RequestForm view={view} />,
				}
			case "sent":
				return {
					tile: "check",
					title: "Request sent",
					lede: "If the owner can share this file with you, they’ll see your request. Open this page again to see their answer.",
					rest: <BackToExagram />,
				}
			case "pending":
				return {
					tile: null,
					title: "Request pending",
					lede: `You asked the owner for access to this file ${askedAgo(now - view.sent.at)}.`,
					rest: <PendingActions view={view} />,
				}
			case "approved":
				return {
					tile: "check",
					title: view.title ? `You now have access to “${view.title}”` : "You now have access to this file",
					lede: `${view.ownerName ?? "The owner"} approved your request as ${roleLabel(view.role)}.`,
					rest: (
						<div style={{ marginTop: 24 }}>
							<Button size={40} onClick={view.onOpen}>
								Open
							</Button>
						</div>
					),
				}
			case "declined":
				return {
					tile: null,
					title: "Your request wasn’t approved",
					lede: "Contact the owner if you still need access.",
					rest: <BackToExagram />,
				}
		}
	})()

	const centered = view.state === "sent"
	return (
		<div className="grid flex-1 place-items-center bg-surface" style={{ minHeight: "100%", padding: "40px 24px" }}>
			<section
				className={`w-full border border-line bg-panel p-6 sm:p-8${centered ? " text-center" : ""}`}
				style={{
					maxWidth: 440,
					borderRadius: 10,
					boxShadow: "0 1px 3px rgba(23,25,35,.04)",
					animation: "fadeUp var(--duration-panel) var(--ease-arrive)",
				}}
			>
				{screen.tile ? (
					<span
						aria-hidden
						className={`grid place-items-center${centered ? " mx-auto" : ""} ${screen.tile === "check" ? "bg-green-bg text-green-fg" : "bg-subtle text-secondary"}`}
						style={{ width: 44, height: 44, borderRadius: screen.tile === "check" ? "50%" : 6, marginBottom: 16 }}
					>
						{screen.tile === "check" ? (
							<IconCheck size={22} strokeWidth={1.8} />
						) : (
							<IconLock size={20} strokeWidth={1.8} />
						)}
					</span>
				) : null}
				<h1
					ref={heading}
					tabIndex={-1}
					className="font-display m-0 text-pretty outline-none"
					style={{ fontWeight: 600, fontSize: 22, letterSpacing: "-.01em" }}
				>
					{screen.title}
				</h1>
				<p className="m-0 text-muted text-pretty" style={{ fontSize: 15, lineHeight: 1.5, marginTop: 6 }}>
					{screen.lede}
				</p>
				{screen.rest}
			</section>
		</div>
	)
}
