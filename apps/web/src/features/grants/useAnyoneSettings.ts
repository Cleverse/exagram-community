import {
	ANYONE_PASSWORD_MIN,
	type AnyoneExpiryDays,
	type AnyoneSettingsPatch,
	type VisibleArtifact,
} from "@exagram/api-client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { useToast } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { generatePassword } from "@/features/grants/anyonePassword"

/** The choices the Link expires select offers; `days` is what `setAnyoneSettings` takes. */
export const EXPIRY_OPTIONS = [
	{ value: "never", label: "Never", days: null },
	{ value: "1", label: "After 1 day", days: 1 },
	{ value: "7", label: "After 7 days", days: 7 },
	{ value: "30", label: "After 30 days", days: 30 },
] as const satisfies readonly { value: string; label: string; days: AnyoneExpiryDays | null }[]

/** An expiry the Owner already set shows as one more, selected, option: the server keeps the date, not the N days. */
export const CURRENT_EXPIRY = "current"
export type ExpiryValue = (typeof EXPIRY_OPTIONS)[number]["value"] | typeof CURRENT_EXPIRY

const expiryValueOf = (days: AnyoneExpiryDays | null) => EXPIRY_OPTIONS.find((option) => option.days === days)?.value

/**
 * The Owner's Link settings for Anyone with the link (ADR 0044), shared by the desktop popover and the phone's
 * drawer step. The server holds a hash, so the password the Owner can see is only what they generated or typed in
 * this Share session (`known`); `typed` is a draft that is not saved until it is long enough and the field is left.
 * While a save is in flight the controls show the value being saved, so a switch moves when it is pressed.
 * Null for a reader who is not the Owner: the server sends no settings to anyone else.
 */
export const useAnyoneSettings = (artifact: VisibleArtifact) => {
	const toast = useToast()
	const queryClient = useQueryClient()
	const [known, setKnown] = useState<string | null>(null)
	const [typed, setTyped] = useState<string | null>(null)
	const [revealed, setRevealed] = useState(false)
	const [previewing, setPreviewing] = useState(false)

	const save = useMutation({
		// The Owner's password is in `variables`; the cache would keep it for minutes after the dialog closes.
		gcTime: 0,
		mutationFn: (patch: AnyoneSettingsPatch) =>
			apiClient.artifacts.setAnyoneSettings({ artifactId: artifact.id, ...patch }),
		onSuccess: (next, patch) => {
			// The answer is the whole Artifact, so every cache that holds it takes it as it is.
			queryClient.setQueryData(QueryKeys.artifacts.get(next.id), next)
			queryClient.setQueriesData<VisibleArtifact[]>({ queryKey: ["artifacts", "list"] }, (rows) =>
				rows?.map((row) => (row.id === next.id ? next : row)),
			)
			if (patch.password !== undefined) {
				setKnown(patch.password)
				setTyped(null)
			}
		},
	})

	const settings = artifact.anyoneSettings
	if (settings === null) return null

	const saving = save.isPending ? save.variables : undefined
	const passwordOn = saving?.passwordOn ?? settings.passwordOn
	const download = saving?.download ?? settings.download
	const expiry: ExpiryValue =
		saving?.expiresInDays !== undefined
			? (expiryValueOf(saving.expiresInDays) ?? CURRENT_EXPIRY)
			: settings.expiresAt === null
				? "never"
				: CURRENT_EXPIRY
	const expired = settings.expiresAt !== null && new Date(settings.expiresAt).getTime() <= Date.now()

	// What the Owner can copy is what is saved or typed; the field also shows a password on its way to being saved.
	const shown = typed ?? known
	const displayed = typed ?? saving?.password ?? known
	const run = (patch: AnyoneSettingsPatch, message?: string) =>
		save.mutate(patch, message === undefined ? undefined : { onSuccess: () => toast(message) })

	return {
		passwordOn,
		download,
		expiry,
		expiresAt: settings.expiresAt,
		expired,
		password: {
			value: displayed ?? "",
			placeholder:
				displayed === null && settings.passwordSet ? "Password set. Type a new one or generate one." : undefined,
			revealed,
			tooShort: typed !== null && typed.length > 0 && typed.length < ANYONE_PASSWORD_MIN,
			canCopy: shown !== null && shown.length > 0,
		},
		saving: save.isPending,
		error: save.isError ? save.error.message : null,

		setPasswordOn: (on: boolean) => {
			if (!on) return run({ passwordOn: false }, "Password removed from the link.")
			// With a stored password the switch only turns it back on; otherwise it needs one.
			if (settings.passwordSet) return run({ passwordOn: true }, "Link is now password protected.")
			run({ passwordOn: true, password: generatePassword() }, "Link is now password protected.")
		},
		typePassword: setTyped,
		/** Saves a draft long enough to be a password; a shorter one stays and shows why. */
		commitTyped: () => {
			if (typed === null || saving?.password === typed) return
			if (typed.length === 0 || typed === known) return setTyped(null)
			if (typed.length >= ANYONE_PASSWORD_MIN) run({ password: typed }, "Password updated. The old one stops working.")
		},
		generate: () => {
			setRevealed(true)
			run({ password: generatePassword() }, "New password generated. The old one stops working.")
		},
		toggleReveal: () => setRevealed((value) => !value),
		copyPassword: () => {
			if (shown === null || shown.length === 0) return
			if (shown.length < ANYONE_PASSWORD_MIN) return toast("Use at least 8 characters before sharing.")
			navigator.clipboard.writeText(shown).then(
				() => toast("Password copied."),
				() => toast("Could not copy — select the password and copy it"),
			)
		},
		setExpiry: (value: ExpiryValue) => {
			const option = EXPIRY_OPTIONS.find((candidate) => candidate.value === value)
			if (option) run({ expiresInDays: option.days })
		},
		setDownload: (on: boolean) => run({ download: on }),

		previewing,
		/** False, with a toast, while the password being typed is too short to send. */
		startPreview: () => {
			if (typed !== null && typed.length > 0 && typed.length < ANYONE_PASSWORD_MIN) {
				toast("Use at least 8 characters first.")
				return false
			}
			setPreviewing(true)
			return true
		},
		endPreview: () => setPreviewing(false),
	}
}

export type AnyoneSettingsModel = NonNullable<ReturnType<typeof useAnyoneSettings>>
