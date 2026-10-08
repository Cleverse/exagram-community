import { type Grant, type GrantRole, type InviteSuggestion, type WorkspaceKind } from "@exagram/api-client"
import { useState } from "react"

import { type InviteInput, useInviteSuggestions } from "@/features/grants/hooks/useGrants"
import { initialRoleFor, peopleCountLabel, rolesUpTo } from "@/features/grants/useShareModel"

/**
 * The v3.8 Invite view's state, apart from how it is drawn (desktop dialog and mobile sheet alike): chips for the
 * people picked, the text that filters the checklist, the role, the Owner's pin, and `submit`, which
 * makes one Grant per chip.
 */

/** A person picked for the invite. `isNew`: not in the workspace yet, so they get an invite email. */
export type InviteChip = { email: string; name: string; isNew: boolean }

/** One row of the checklist: a Member (or someone already invited) from the suggestions. */
export type InviteCandidate = InviteSuggestion & { selected: boolean }

/** What one chip's create came back with. */
export type InviteOutcome = { email: string; grant: Grant } | { email: string; error: string }

/** The server's cap on one suggestions call (`MAX_INVITE_SUGGESTIONS` in the grants contract). */
const CHECKLIST_SIZE = 50

// Deliberately loose: the server's z.email() is the authority; this only decides when to offer "Invite {email}".
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const isFullEmail = (text: string) => EMAIL.test(text.trim())

/** Shown when Enter is pressed on text that is neither a person in the list nor a full email address. */
export const NOT_AN_EMAIL = "Enter a full email address, or pick someone from the list"

/** Exagram sends no email, so when anyone picked shows only by email the toast tells the sharer to send them the link. */
export const inviteToast = (created: Grant[]): string => {
	const invited = created.filter((grant) => grant.granteePending)
	if (invited.length > 0) {
		const who = invited.length === 1 ? (invited[0]?.granteeEmail ?? "them") : "them"
		return `Shared · send ${who} the link.`
	}
	return `Shared with ${peopleCountLabel(created.length)} · ${created.length} can open it.`
}

export const useInvitePicker = ({
	target,
	ceiling,
	kind,
	defaultPinnedRevisionId,
	create,
}: {
	target: { artifactId: string } | { projectId: string }
	ceiling: GrantRole | null
	kind: WorkspaceKind
	/**
	 * The pin a new Grant starts with, for the Owner's pin select: null follows latest, a Revision id pins it.
	 * Undefined hides the pin (a Project, or anyone but the Owner) and lets the server apply the Default Pin.
	 */
	defaultPinnedRevisionId?: string | null
	/** One Grant; rejects with the refusal's message. */
	create: (input: InviteInput) => Promise<Grant>
}) => {
	const options = rolesUpTo(ceiling, kind)
	const [chips, setChips] = useState<InviteChip[]>([])
	const [text, setText] = useState("")
	// Role and pin hold only what was picked; until then they follow the ceiling and starting pin, which a Project's
	// access (and so the Owner's pin) may only learn after the first render.
	const [pickedRole, setRole] = useState<GrantRole | null>(null)
	const role =
		pickedRole !== null && options.includes(pickedRole)
			? pickedRole
			: options.includes(initialRoleFor(kind))
				? initialRoleFor(kind)
				: "view"
	const [pickedPin, setPickedPin] = useState<{ id: string | null } | null>(null)
	const pinnedRevisionId =
		defaultPinnedRevisionId === undefined ? undefined : pickedPin ? pickedPin.id : defaultPinnedRevisionId
	const setPinnedRevisionId = (id: string | null) => setPickedPin({ id })
	const [submitting, setSubmitting] = useState(false)
	const [failures, setFailures] = useState<Record<string, string>>({})

	const suggestions = useInviteSuggestions(target, text, options.length > 0, CHECKLIST_SIZE)
	const picked = new Set(chips.map((chip) => chip.email.toLowerCase()))
	const trimmed = text.trim()

	// The server narrows by the text too, but a previous answer stays up while the next loads, so Enter and the
	// checklist never offer someone the text no longer matches.
	const needle = trimmed.toLowerCase()
	const people = (suggestions.data ?? []).filter(
		(person) => person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle),
	)
	// New invitees (already invited, or the typed address) first, as v3.8 lists them.
	const candidates: InviteCandidate[] = [...people]
		.sort((a, b) => Number(b.pending) - Number(a.pending))
		.map((person) => ({ ...person, selected: picked.has(person.email.toLowerCase()) }))

	const typedIsKnown = people.some((person) => person.email.toLowerCase() === trimmed.toLowerCase())
	/** "Invite {email}" under "Not in {workspace} yet": a full address that matches nobody and is not picked. */
	const newEmail = isFullEmail(trimmed) && !typedIsKnown && !picked.has(trimmed.toLowerCase()) ? trimmed : null

	const add = (chip: InviteChip) => {
		if (picked.has(chip.email.toLowerCase())) return
		setChips((current) => [...current, chip])
		setText("")
	}

	const remove = (email: string) => {
		setChips((current) => current.filter((chip) => chip.email.toLowerCase() !== email.toLowerCase()))
		setFailures((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== email)))
	}

	/** A checklist row toggles its person in or out. */
	const toggle = (person: InviteSuggestion) => {
		if (picked.has(person.email.toLowerCase())) remove(person.email)
		else add({ email: person.email, name: person.name, isNew: person.pending })
	}

	/** The typed address as a "New to {workspace}" chip. */
	const addNewEmail = () => {
		if (newEmail) add({ email: newEmail, name: newEmail, isNew: true })
	}

	/**
	 * Enter: the typed new address, else the first person the text matches. Returns an error to toast when the
	 * text is neither; null when it did something or there was nothing typed. Never appends a domain.
	 */
	const enter = (): string | null => {
		if (trimmed === "") return null
		if (picked.has(needle)) {
			setText("")
			return null
		}
		if (newEmail) {
			addNewEmail()
			return null
		}
		const first = candidates.find((candidate) => !candidate.selected)
		if (first) {
			toggle(first)
			return null
		}
		return NOT_AN_EMAIL
	}

	/** Backspace on an empty input takes the last chip back out. */
	const backspace = () => {
		if (text !== "" || chips.length === 0) return false
		const last = chips[chips.length - 1]
		if (last) remove(last.email)
		return true
	}

	const reset = () => {
		setChips([])
		setText("")
		setFailures({})
		setPickedPin(null)
	}

	/**
	 * One Grant per chip, in order. Each succeeds or fails on its own: successes leave the chip list, failures stay
	 * with their error.
	 */
	const submit = async (): Promise<{ created: Grant[]; failed: { email: string; error: string }[] }> => {
		if (chips.length === 0 || submitting) return { created: [], failed: [] }
		setSubmitting(true)
		const outcomes: InviteOutcome[] = []
		try {
			for (const chip of chips) {
				try {
					const grant = await create({
						granteeEmail: chip.email,
						role,
						...(pinnedRevisionId !== undefined ? { pinnedRevisionId } : {}),
					})
					outcomes.push({ email: chip.email, grant })
				} catch (error) {
					outcomes.push({ email: chip.email, error: error instanceof Error ? error.message : "Could not invite" })
				}
			}
		} finally {
			setSubmitting(false)
		}
		const created = outcomes.flatMap((outcome) => ("grant" in outcome ? [outcome.grant] : []))
		const failed = outcomes.flatMap((outcome) => ("error" in outcome ? [outcome] : []))
		const done = new Set(created.map((grant) => grant.granteeEmail.toLowerCase()))
		setChips((current) => current.filter((chip) => !done.has(chip.email.toLowerCase())))
		setFailures(Object.fromEntries(failed.map((failure) => [failure.email, failure.error])))
		return { created, failed }
	}

	return {
		options,
		chips,
		text,
		setText,
		role,
		setRole,
		pinnedRevisionId,
		setPinnedRevisionId,
		/** The pin select shows only when the caller passed a starting pin (the Owner, on an Artifact). */
		showPin: defaultPinnedRevisionId !== undefined,
		candidates,
		newEmail,
		failures,
		submitting,
		canSubmit: chips.length > 0 && !submitting,
		toggle,
		addNewEmail,
		enter,
		backspace,
		remove,
		reset,
		submit,
	}
}
