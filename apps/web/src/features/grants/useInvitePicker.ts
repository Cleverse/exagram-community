import {
	type Grant,
	type GrantRole,
	type GroupSuggestion,
	type InviteSuggestion,
	type WorkspaceKind,
} from "@exagram/api-client"
import { useState } from "react"

import { type InviteInput, useInviteSuggestions } from "@/features/grants/hooks/useGrants"
import { rolesUpTo, startingRole, whoLabel } from "@/features/grants/useShareModel"

/**
 * The v3.8 Invite view's state, apart from how it is drawn (desktop dialog and mobile sheet alike): chips for the
 * people picked, the text that filters the checklist, the role, the Owner's pin, and `submit`, which
 * makes one Grant per chip.
 */

export type InviteChip =
	| { kind: "person"; email: string; name: string; isNew: boolean }
	| { kind: "group"; id: string; name: string; memberCount: number }

const groupKey = (id: string) => `group:${id}`

export const chipKey = (chip: InviteChip): string =>
	chip.kind === "group" ? groupKey(chip.id) : chip.email.toLowerCase()

export const chipLabel = (chip: InviteChip): string => (chip.kind === "group" ? chip.name : chip.email)

/** One row of the checklist: a Member (or someone already invited) from the suggestions. */
export type InviteCandidate = InviteSuggestion & { selected: boolean }

export type GroupCandidate = GroupSuggestion & { selected: boolean }

/** What one chip's create came back with. */
type Who = { key: string; label: string; kind: InviteChip["kind"] }

export type InviteOutcome = (Who & { grant: Grant }) | (Who & { error: string })

/** The server's cap on one suggestions call (`MAX_INVITE_SUGGESTIONS` in the grants contract). */
const CHECKLIST_SIZE = 50

// Deliberately loose: the server's z.email() is the authority; this only decides when to offer "Invite {email}".
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const isFullEmail = (text: string) => EMAIL.test(text.trim())

/** Shown when Enter is pressed on text that is neither a person in the list nor a full email address. */
export const NOT_AN_EMAIL = "Enter a full email address, or pick someone from the list"

/** Exagram sends no share email, so for anyone who shows only by email the toast tells the sharer to send the link. */
export const inviteToast = (created: Grant[], linkCopyable = true): string => {
	const invited = created.filter((grant) => grant.granteePending)
	const groups = created.flatMap((grant) => (grant.grantee.kind === "group" ? [grant.grantee] : []))
	const people = created.length - groups.length
	const shared = `Shared with ${whoLabel(people, groups.length)}`
	if (invited.length === 0) {
		const reach = people + groups.reduce((total, group) => total + group.memberCount, 0)
		return `${shared} · ${groups.length > 0 ? "up to " : ""}${reach} can open it.`
	}
	const onlyInvited = invited.length === created.length
	const lead = onlyInvited ? "Shared" : shared
	if (!linkCopyable) {
		const who = invited.length === 1 ? (invited[0]?.granteeEmail ?? "they") : onlyInvited ? "they" : "the new people"
		return `${lead} · ${who} ${invited.length === 1 ? "needs" : "need"} an invite link from an Admin.`
	}
	const sendTo = invited.length === 1 ? (invited[0]?.granteeEmail ?? "them") : onlyInvited ? "them" : "the new people"
	return `${lead} · send ${sendTo} the link.`
}

const granteeOf = (chip: InviteChip) => (chip.kind === "group" ? { groupId: chip.id } : { granteeEmail: chip.email })

export const useInvitePicker = ({
	target,
	ceiling,
	kind,
	defaultRole,
	defaultPinnedRevisionId,
	create,
}: {
	target: { artifactId: string } | { projectId: string }
	ceiling: GrantRole | null
	kind: WorkspaceKind
	defaultRole?: GrantRole
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
	const [pickedRole, setRole] = useState<GrantRole | null>(null)
	const role =
		pickedRole !== null && options.includes(pickedRole) ? pickedRole : startingRole(kind, defaultRole, options)
	const [pickedPin, setPickedPin] = useState<{ id: string | null } | null>(null)
	const pinnedRevisionId =
		defaultPinnedRevisionId === undefined ? undefined : pickedPin ? pickedPin.id : defaultPinnedRevisionId
	const setPinnedRevisionId = (id: string | null) => setPickedPin({ id })
	const [submitting, setSubmitting] = useState(false)
	const [failures, setFailures] = useState<Record<string, string>>({})

	const suggestions = useInviteSuggestions(target, text, options.length > 0, CHECKLIST_SIZE)
	const picked = new Set(chips.map(chipKey))
	const trimmed = text.trim()

	// The server narrows by the text too, but a previous answer stays up while the next loads, so Enter and the
	// checklist never offer someone the text no longer matches.
	const needle = trimmed.toLowerCase()
	const people = (suggestions.data?.people ?? []).filter(
		(person) => person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle),
	)
	const matchingGroups = (suggestions.data?.groups ?? []).filter((group) => group.name.toLowerCase().includes(needle))
	// New invitees (already invited, or the typed address) first, as v3.8 lists them.
	const candidates: InviteCandidate[] = [...people]
		.sort((a, b) => Number(b.pending) - Number(a.pending))
		.map((person) => ({ ...person, selected: picked.has(person.email.toLowerCase()) }))
	const groups: GroupCandidate[] = matchingGroups.map((group) => ({
		...group,
		selected: picked.has(groupKey(group.id)),
	}))

	const typedIsKnown = people.some((person) => person.email.toLowerCase() === trimmed.toLowerCase())
	/** "Invite {email}" under "Not in {workspace} yet": a full address that matches nobody and is not picked. */
	const newEmail = isFullEmail(trimmed) && !typedIsKnown && !picked.has(trimmed.toLowerCase()) ? trimmed : null

	const add = (chip: InviteChip) => {
		if (picked.has(chipKey(chip))) return
		setChips((current) => [...current, chip])
		setText("")
	}

	const remove = (key: string) => {
		setChips((current) => current.filter((chip) => chipKey(chip) !== key))
		setFailures((current) => Object.fromEntries(Object.entries(current).filter(([failed]) => failed !== key)))
	}

	/** A checklist row toggles its person in or out. */
	const toggle = (person: InviteSuggestion) => {
		const key = person.email.toLowerCase()
		if (picked.has(key)) remove(key)
		else add({ kind: "person", email: person.email, name: person.name, isNew: person.pending })
	}

	const toggleGroup = (group: GroupSuggestion) => {
		const key = groupKey(group.id)
		if (picked.has(key)) remove(key)
		else add({ kind: "group", id: group.id, name: group.name, memberCount: group.memberCount })
	}

	/** The typed address as a "New to {workspace}" chip. */
	const addNewEmail = () => {
		if (newEmail) add({ kind: "person", email: newEmail, name: newEmail, isNew: true })
	}

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
		const firstGroup = groups.find((group) => !group.selected)
		if (firstGroup) {
			toggleGroup(firstGroup)
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
		if (last) remove(chipKey(last))
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
	const submit = async (): Promise<{
		created: Grant[]
		failed: (Who & { error: string })[]
	}> => {
		if (chips.length === 0 || submitting) return { created: [], failed: [] }
		setSubmitting(true)
		const outcomes: InviteOutcome[] = []
		try {
			for (const chip of chips) {
				const who: Who = { key: chipKey(chip), label: chipLabel(chip), kind: chip.kind }
				try {
					const grant = await create({
						...granteeOf(chip),
						role,
						...(pinnedRevisionId !== undefined ? { pinnedRevisionId } : {}),
					})
					outcomes.push({ ...who, grant })
				} catch (error) {
					outcomes.push({ ...who, error: error instanceof Error ? error.message : "Could not invite" })
				}
			}
		} finally {
			setSubmitting(false)
		}
		const created = outcomes.flatMap((outcome) => ("grant" in outcome ? [outcome.grant] : []))
		const failed = outcomes.flatMap((outcome) => ("error" in outcome ? [outcome] : []))
		const done = new Set(outcomes.flatMap((outcome) => ("grant" in outcome ? [outcome.key] : [])))
		setChips((current) => current.filter((chip) => !done.has(chipKey(chip))))
		setFailures(Object.fromEntries(failed.map((failure) => [failure.key, failure.error])))
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
		groups,
		candidates,
		newEmail,
		failures,
		submitting,
		canSubmit: chips.length > 0 && !submitting,
		toggle,
		toggleGroup,
		addNewEmail,
		enter,
		backspace,
		remove,
		reset,
		submit,
	}
}
