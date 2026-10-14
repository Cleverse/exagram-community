import {
	type Grant,
	type GrantRole,
	type LinkPreview,
	type PublishPolicy,
	type VisibleArtifact,
	type WorkspaceKind,
} from "@exagram/api-client"
import clsx from "clsx"
import { type ReactNode, useContext, useState } from "react"

import { Segmented, SheetRow } from "@/components/mobile/primitives"
import { SheetFrameContext, useSheet } from "@/components/mobile/sheet/context"
import { useBackCloses } from "@/components/mobile/sheet/history"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams, type ShareTarget } from "@/components/mobile/sheet/types"
import { useToast } from "@/components/Toast"
import {
	IconCheck,
	IconChevronDown,
	IconClose,
	IconEye,
	IconGear,
	IconMail,
	IconPeople,
	IconSlidersHorizontal,
} from "@/components/ui/icons"
import { edition } from "@/edition/edition"
import { useArtifactViewers } from "@/features/artifact/hooks/useLedger"
import { RecipientPreview } from "@/features/artifact/PasswordGate"
import { buttonStyle, inkButtonClass, outlineButtonClass, useSheetArtifact } from "@/features/artifact/sheets/sheetData"
import { SheetGone, SheetLoading, SheetNote } from "@/features/artifact/sheets/sheetParts"
import { AnyoneSettingsControls } from "@/features/grants/AnyoneSettings"
import { generalAccessCopied } from "@/features/grants/general-access/generalAccess"
import { GeneralAccessSection } from "@/features/grants/general-access/GeneralAccessSection"
import { Heading } from "@/features/grants/shareParts"
import { copyInviteLink, NEEDS_JOIN_LINK } from "@/features/grants/sheets/inviteLink"
import { type AnyoneSettingsModel } from "@/features/grants/useAnyoneSettings"
import { chipKey, chipLabel, inviteToast, useInvitePicker } from "@/features/grants/useInvitePicker"
import {
	copyShareLink,
	groupLine,
	initialsOf,
	INVITED_META,
	invitePlaceholder,
	newPersonCopy,
	roleLabel,
	shownRole,
	useArtifactShareModel,
	useProjectShareModel,
} from "@/features/grants/useShareModel"
import { FILLS } from "@/features/library/avatarFills"
import { useProjects } from "@/features/library/hooks/useProjects"
import { PUBLISH_POLICY_OPTIONS } from "@/features/project/publishPolicy"

/** Share's steps inside one drawer: the people list, the Invite view, Sharing settings (v3.8) and Link settings. */
type Step = "share" | "invite" | "settings" | "viewers" | "anyone"

type Picker = ReturnType<typeof useInvitePicker>

/**
 * A step inside the Share drawer: its header shows Back, which returns to the Share step instead of leaving the
 * drawer. The drawer's own frame is reused, only its depth and Back replaced. The step holds its own history
 * entry over the drawer's, so the phone's Back returns to Share too, and the next Back closes the drawer.
 */
const InnerStep = ({ onBack, children }: { onBack: () => void; children: ReactNode }) => {
	useBackCloses(true, onBack)
	const frame = useContext(SheetFrameContext)
	if (!frame) throw new Error("<InnerStep> renders inside a SheetProvider drawer")
	return (
		<SheetFrameContext.Provider value={{ ...frame, depth: frame.depth + 1, back: onBack }}>
			{children}
		</SheetFrameContext.Provider>
	)
}

/** A tint pair from the initials, so one person keeps one colour across the checklist (v3.8 "Library owner column"). */
const tintOf = (initials: string): [string, string] => {
	const sum = [...initials].reduce((total, char) => total + char.charCodeAt(0), 0)
	return FILLS[sum % FILLS.length] ?? ["var(--color-subtle)", "var(--color-ink)"]
}

/**
 * Round initials: 40px light gray on the people list, 48px tinted in the Invite checklist (the v3.8 mobile
 * mockups).
 */
const Initials = ({ name, size = 40, tinted = false }: { name: string; size?: number; tinted?: boolean }) => {
	const initials = initialsOf(name)
	const [background, color] = tinted ? tintOf(initials) : ["var(--color-subtle)", "var(--color-ink)"]
	return (
		<span
			aria-hidden
			className="grid flex-none place-items-center"
			style={{ width: size, height: size, borderRadius: "50%", background, color, fontSize: 12.5, fontWeight: 600 }}
		>
			{initials}
		</span>
	)
}

const MailAvatar = ({ size = 40 }: { size?: number }) => (
	<span
		aria-hidden
		className="grid flex-none place-items-center text-secondary"
		style={{ width: size, height: size, borderRadius: "50%", border: "1px dashed var(--color-line-strong)" }}
	>
		<IconMail size={17} />
	</span>
)

const GroupAvatar = ({ size = 40 }: { size?: number }) => (
	<span
		aria-hidden
		className="grid flex-none place-items-center bg-subtle text-ink"
		style={{ width: size, height: size, borderRadius: "50%" }}
	>
		<IconPeople size={size >= 48 ? 22 : 19} />
	</span>
)

/** A person with access: avatar, name over meta, and their role on the right. */
const PersonRow = ({
	name,
	you = false,
	meta,
	avatar,
	children,
}: {
	name: string
	you?: boolean
	meta: string | null
	avatar?: ReactNode
	children?: ReactNode
}) => (
	<div className="flex items-center" style={{ gap: 12, minHeight: 64 }}>
		{avatar ?? <Initials name={name} />}
		<span className="min-w-0 flex-1">
			<span className="block truncate" style={{ fontSize: 15, fontWeight: 500 }}>
				{you ? `${name} (you)` : name}
			</span>
			{meta ? (
				<span className="block truncate text-muted-2" style={{ fontSize: 13 }}>
					{meta}
				</span>
			) : null}
		</span>
		{children}
	</div>
)

/** "Owner", or a role the caller may not change: gray text where the others have a select. */
const RoleText = ({ children }: { children: string }) => (
	<span className="flex-none text-muted-2" style={{ fontSize: 14, padding: "0 8px" }}>
		{children}
	</span>
)

/** The Owner opens the Role drawer from a grantee's role; everyone else reads it as text. */
const GranteeRole = ({
	grant,
	kind,
	canManage,
	target,
}: {
	grant: Grant
	kind: WorkspaceKind
	canManage: boolean
	target: ShareTarget
}) => {
	const sheet = useSheet()
	if (!canManage) return <RoleText>{roleLabel(grant.role)}</RoleText>
	const shown = shownRole(kind, grant.role)
	return (
		<button
			type="button"
			aria-label={`${roleLabel(shown)}, change access for ${grant.granteeName}`}
			onClick={() => sheet.push("role", { target, granteeKey: grant.id, kind })}
			className="flex flex-none items-center text-ink active:bg-hover"
			style={{ height: 36, padding: "0 8px 0 10px", gap: 6, fontSize: 14, borderRadius: 8 }}
		>
			{roleLabel(shown)}
			<IconChevronDown size={13} />
		</button>
	)
}

/** A borderless select that reads as its value and a chevron (the Invite card's role and pin). */
const InlineSelect = ({
	label,
	value,
	onChange,
	children,
}: {
	label: string
	value: string
	onChange: (value: string) => void
	children: ReactNode
}) => (
	<span className="relative flex flex-none items-center text-muted">
		<select
			aria-label={label}
			value={value}
			onChange={(event) => onChange(event.target.value)}
			className="appearance-none bg-transparent outline-none"
			style={{ height: 36, padding: "0 22px 0 6px", fontSize: 15, color: "inherit" }}
		>
			{children}
		</select>
		<IconChevronDown size={13} className="pointer-events-none absolute" style={{ right: 4 }} />
	</span>
)

const AddPeople = ({ canInvite, why, onOpen }: { canInvite: boolean; why: string | null; onOpen: () => void }) =>
	canInvite ? (
		<button
			type="button"
			onClick={onOpen}
			className="flex w-full items-center border border-line-strong bg-white text-left text-muted-2 active:bg-hover"
			style={{ height: 48, padding: "0 14px", fontSize: 16, borderRadius: 12 }}
		>
			Add people by name or email
		</button>
	) : why === null ? null : (
		<p className="text-muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
			{why}
		</p>
	)

/**
 * Copy link on an Invited row: Exagram emails no one, so the sharer sends the link. Anyone who may
 * invite sees it.
 */
const CopyInviteLink = ({ grant, url }: { grant: Grant; url: string }) => {
	const toast = useToast()
	const copyable = edition.useInviteLinkCopyable()
	if (!copyable) return null
	return (
		<button
			type="button"
			aria-label={`Copy link for ${grant.granteeEmail}`}
			onClick={() => void copyInviteLink(url, grant.granteeEmail, toast)}
			className="flex-none text-ink active:bg-hover"
			style={{ height: 36, padding: "0 8px", fontSize: 14, fontWeight: 500, borderRadius: 8 }}
		>
			Copy link
		</button>
	)
}

/** "Invited · N" under People with access: shared with by email, waiting on their first sign-in. */
const InvitedSection = ({
	invited,
	kind,
	canManage,
	target,
	linkUrl,
}: {
	invited: Grant[]
	kind: WorkspaceKind
	canManage: boolean
	target: ShareTarget
	/** The item's URL for Copy link; null for a Viewer, who may not invite. */
	linkUrl: string | null
}) => {
	const copyable = edition.useInviteLinkCopyable()
	return invited.length === 0 ? null : (
		<section aria-label="Invited">
			<Heading note="Access starts at first sign-in">Invited · {invited.length}</Heading>
			{invited.map((grant) => (
				<PersonRow
					key={grant.id}
					name={grant.granteeEmail}
					meta={copyable ? INVITED_META : NEEDS_JOIN_LINK}
					avatar={<MailAvatar />}
				>
					{linkUrl ? <CopyInviteLink grant={grant} url={linkUrl} /> : null}
					<GranteeRole grant={grant} kind={kind} canManage={canManage} target={target} />
				</PersonRow>
			))}
		</section>
	)
}

/** The Owner's way into Sharing settings, desktop's gear popover as a drawer row. */
const SettingsRow = ({ value, onOpen }: { value: string; onOpen: () => void }) => (
	<div style={{ margin: "14px -10px 0" }}>
		<SheetRow icon={<IconGear size={17} />} label="Sharing settings" value={value} chevron onClick={onOpen} />
	</div>
)

/** The Owner's way into Link settings, the popover beside General access on desktop as a drawer row. */
const AnyoneSettingsRow = ({ anyone, onOpen }: { anyone: AnyoneSettingsModel; onOpen: () => void }) => (
	<div style={{ margin: "8px -10px 0" }}>
		<SheetRow
			icon={<IconSlidersHorizontal size={17} />}
			label="Link settings"
			value={anyone.passwordOn ? "Password on" : "No password"}
			chevron
			onClick={onOpen}
		/>
	</div>
)

/** Require password, Link expires and Allow download, on their own step of the drawer. */
const AnyoneSettingsStep = ({ artifact, anyone }: { artifact: VisibleArtifact; anyone: AnyoneSettingsModel }) => (
	<Sheet title="Link settings" sub={artifact.title}>
		<div className="flex flex-col" style={{ gap: 18, padding: "8px 16px 16px" }}>
			<AnyoneSettingsControls anyone={anyone} touch />
		</div>
	</Sheet>
)

/** The v3.8 footer's buttons: 48px, 14px radius. */
const footerButtonStyle = { ...buttonStyle, height: 48, fontSize: 15, borderRadius: 14 } as const

/**
 * Copy link and Done, side by side, pinned under the scrolling list with no gray band so Done
 * never scrolls away.
 */
const Footer = ({ url, copiedMessage }: { url: string; copiedMessage?: string }) => {
	const sheet = useSheet()
	const toast = useToast()
	return (
		<div
			className="sticky bottom-0 grid bg-white"
			style={{ gridTemplateColumns: "1fr 1fr", gap: 10, padding: "12px 16px 14px" }}
		>
			<button
				type="button"
				onClick={() => void copyShareLink(url, toast, copiedMessage)}
				className={outlineButtonClass}
				style={footerButtonStyle}
			>
				Copy link
			</button>
			<button type="button" onClick={sheet.close} className={inkButtonClass} style={footerButtonStyle}>
				Done
			</button>
		</div>
	)
}

const Body = ({ children }: { children: ReactNode }) => <div style={{ padding: "4px 16px 8px" }}>{children}</div>

const CheckRow = ({
	name,
	meta,
	avatar,
	selected,
	onToggle,
}: {
	name: string
	meta: string
	avatar: ReactNode
	selected: boolean
	onToggle: () => void
}) => (
	<button
		type="button"
		role="checkbox"
		aria-checked={selected}
		aria-label={name}
		onClick={onToggle}
		className="flex w-full items-center text-left active:bg-hover"
		style={{ gap: 14, minHeight: 72 }}
	>
		{avatar}
		<span className="min-w-0 flex-1">
			<span className="block truncate" style={{ fontSize: 15.5, fontWeight: 500 }}>
				{name}
			</span>
			<span className="block truncate text-muted-2" style={{ fontSize: 13.5 }}>
				{meta}
			</span>
		</span>
		<span
			aria-hidden
			className={clsx(
				"grid flex-none place-items-center",
				selected ? "bg-ink text-white" : "border-[1.5px] border-line-strong",
			)}
			style={{ width: 24, height: 24, borderRadius: "50%" }}
		>
			{selected ? <IconCheck size={14} /> : null}
		</span>
	</button>
)

/**
 * The Invite step: a chip field, the role (and the Owner's pin on a file), a checklist of the
 * workspace filtered by what is typed, "Invite {email}" for a full address nobody holds, and a sticky Invite
 * button. It sends one Grant per chip; with nothing refused it steps back to Share.
 */
const InviteStep = ({
	title,
	picker,
	kind,
	workspace,
	pins,
	onDone,
}: {
	title: string
	picker: Picker
	kind: WorkspaceKind
	workspace: string
	/** The pin select's choices after Latest: approved revisions, newest first. */
	pins: { id: string; seq: number }[]
	onDone: () => void
}) => {
	const toast = useToast()
	const copy = newPersonCopy(kind, workspace)
	const copyable = edition.useInviteLinkCopyable()

	const submit = async () => {
		if (!picker.canSubmit) return
		const { created, failed } = await picker.submit()
		const lines = [
			...(created.length > 0 ? [inviteToast(created, copyable)] : []),
			...failed.map((failure) => `Could not invite ${failure.label}: ${failure.error}`),
		]
		if (lines.length > 0) toast(lines.join(" "))
		if (failed.length === 0) onDone()
	}

	return (
		// Full height, as the mockup draws it: the checklist grows into the space and Invite sits at
		// the bottom of the drawer, not under the last row.
		<Sheet title="Invite" sub={title} full>
			<div className="flex min-h-full flex-col">
				<div className="flex-1">
					<Body>
						{/* One card: chips and the field on top, a hairline, then the pin and role on the right. Focused, it
				    takes a dark border and a soft ring (the v3.8 mobile mockup). */}
						<div
							className="border border-line-strong bg-white focus-within:border-ink focus-within:shadow-[0_0_0_4px_var(--color-row-selected)]"
							style={{ borderRadius: 12 }}
						>
							<div className="flex flex-wrap items-center" style={{ gap: 6, padding: "8px 12px", minHeight: 48 }}>
								{picker.chips.map((chip) => {
									const isNew = chip.kind === "person" && chip.isNew
									return (
										<span
											key={chipKey(chip)}
											className={clsx(
												"flex max-w-full items-center bg-subtle",
												picker.failures[chipKey(chip)] ? "text-danger" : "text-ink",
											)}
											style={{
												gap: 4,
												height: 28,
												padding: "0 4px 0 10px",
												borderRadius: 999,
												fontSize: 13.5,
												border: isNew ? "1px dashed var(--color-line-strong)" : "1px solid transparent",
											}}
										>
											{chip.kind === "group" ? <IconPeople size={14} className="flex-none" /> : null}
											<span className="truncate">{chip.name}</span>
											{isNew ? <span className="flex-none text-muted-2">· {copy.badge}</span> : null}
											{chip.kind === "group" ? (
												<>
													<span aria-hidden className="flex-none text-muted-2">
														· {chip.memberCount === 1 ? "1 member" : `${chip.memberCount} members`}
													</span>
													<span className="sr-only">{groupLine(chip.memberCount, picker.role)}</span>
												</>
											) : null}
											<button
												type="button"
												aria-label={`Remove ${chipLabel(chip)}`}
												onClick={() => picker.remove(chipKey(chip))}
												className="grid flex-none place-items-center text-secondary"
												style={{ width: 22, height: 22, borderRadius: "50%" }}
											>
												<IconClose size={12} />
											</button>
										</span>
									)
								})}
								<input
									aria-label="Add people by name or email"
									type="email"
									inputMode="email"
									autoCapitalize="off"
									enterKeyHint="done"
									autoFocus
									value={picker.text}
									onChange={(event) => picker.setText(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault()
											const error = picker.enter()
											if (error) toast(error)
										} else if (event.key === "Backspace" && picker.backspace()) {
											event.preventDefault()
										}
									}}
									placeholder={invitePlaceholder(kind, "sheet", picker.chips.length)}
									className="min-w-0 flex-1 bg-transparent outline-none"
									style={{ height: 32, minWidth: 120, fontSize: 16 }}
								/>
							</div>
							<div
								className="flex items-center justify-end border-t border-row-line"
								style={{ gap: 4, margin: "0 12px", padding: "4px 0" }}
							>
								{picker.showPin ? (
									<InlineSelect
										label="Version"
										value={picker.pinnedRevisionId ?? ""}
										onChange={(value) => picker.setPinnedRevisionId(value === "" ? null : value)}
									>
										<option value="">Latest</option>
										{pins.map((pin) => (
											<option key={pin.id} value={pin.id}>
												v{pin.seq} only
											</option>
										))}
									</InlineSelect>
								) : null}
								<InlineSelect label="Role" value={picker.role} onChange={(value) => picker.setRole(value as GrantRole)}>
									{picker.options.map((option) => (
										<option key={option} value={option}>
											{roleLabel(option)}
										</option>
									))}
								</InlineSelect>
							</div>
						</div>
						{picker.chips.flatMap((chip) => {
							const error = picker.failures[chipKey(chip)]
							return error === undefined
								? []
								: [
										<p key={chipKey(chip)} role="alert" className="text-danger" style={{ fontSize: 13, marginTop: 6 }}>
											{chipLabel(chip)}: {error}
										</p>,
									]
						})}
						<div style={{ marginTop: 8 }}>
							{picker.groups.length > 0 ? (
								<div role="group" aria-label="Groups">
									{picker.groups.map((group) => (
										<CheckRow
											key={group.id}
											name={group.name}
											meta={groupLine(group.memberCount)}
											avatar={<GroupAvatar size={48} />}
											selected={group.selected}
											onToggle={() => picker.toggleGroup(group)}
										/>
									))}
								</div>
							) : null}
							{picker.newEmail ? (
								<button
									type="button"
									onClick={picker.addNewEmail}
									className="flex w-full items-center text-left active:bg-hover"
									style={{ gap: 14, minHeight: 72 }}
								>
									<MailAvatar size={48} />
									<span className="min-w-0 flex-1">
										<span className="block truncate" style={{ fontSize: 15.5, fontWeight: 500 }}>
											Invite {picker.newEmail}
										</span>
										<span className="block text-muted-2" style={{ fontSize: 13.5, lineHeight: 1.4 }}>
											{copyable ? copy.row : NEEDS_JOIN_LINK}
										</span>
									</span>
								</button>
							) : null}
							<div role="group" aria-label="People">
								{picker.candidates.map((person) => (
									<CheckRow
										key={person.id}
										name={person.name}
										meta={person.pending ? `${person.email} · hasn’t signed in yet` : person.email}
										avatar={
											person.pending ? <MailAvatar size={48} /> : <Initials name={person.name} size={48} tinted />
										}
										selected={person.selected}
										onToggle={() => picker.toggle(person)}
									/>
								))}
							</div>
						</div>
					</Body>
				</div>
				{/* Pinned under the checklist, so Invite never scrolls away. */}
				<div className="sticky bottom-0 border-t border-row-line bg-white" style={{ padding: "4px 16px 14px" }}>
					<button
						type="button"
						disabled={!picker.canSubmit}
						onClick={() => void submit()}
						className={clsx("w-full", picker.canSubmit ? "bg-ink text-white active:bg-primary-hover" : null)}
						// Disabled reads as the mockup's pale #F2F2F6 with #969AAA text, not a faded dark button.
						style={{
							...footerButtonStyle,
							marginTop: 10,
							...(picker.canSubmit ? {} : { background: "var(--color-row-selected)", color: "#969aaa" }),
						}}
					>
						{picker.submitting ? "Inviting…" : "Invite"}
					</button>
				</div>
			</div>
		</Sheet>
	)
}

/** One Sharing setting: its name, the choice and what it means. */
const Setting = ({ label, children, note }: { label: string; children: ReactNode; note: string }) => (
	<>
		<Heading>{label}</Heading>
		<div style={{ height: 8 }} />
		{children}
		<p className="text-muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.45 }}>
			{note}
		</p>
	</>
)

const POLICY_WORD: Record<PublishPolicy, string> = { auto: "Automatic", manual: "Manual" }
const FOLLOW = "follow"

const ArtifactSettingsStep = ({
	artifact,
	model,
}: {
	artifact: VisibleArtifact
	model: ReturnType<typeof useArtifactShareModel>
}) => {
	const rev = `v${artifact.revisionSeq ?? 1}`
	return (
		<Sheet title="Sharing settings" sub={artifact.title}>
			<Body>
				{/* The design's "Clients read" Latest / Pin is, in the API, what a newly invited person
				    reads: the file's default pin, the same choice as desktop's "New people see". */}
				<Setting
					label="New people see"
					note={
						artifact.defaultPin === "latest"
							? `People you invite read the newest ${model.workspace.kind === "team" ? "approved " : ""}revision.`
							: `People you invite keep reading ${rev} until you change their pin.`
					}
				>
					<Segmented
						label="New people see"
						options={[
							{ value: "latest", label: "Latest" },
							{ value: "current", label: `Pin ${rev}` },
						]}
						value={artifact.defaultPin}
						onChange={(defaultPin) => {
							if (!model.mutations.setDefaultPin.isPending) model.mutations.setDefaultPin.mutate({ defaultPin })
						}}
					/>
				</Setting>
				{/* Owner only, as on desktop: the file's own publish policy, or follow its Project's. */}
				{model.workspace.kind === "team" ? (
					<Setting
						label="Publishing"
						note={
							artifact.effectivePublishPolicy === "auto"
								? "Owner and Editor uploads go live right away."
								: "Every new version waits for your approval."
						}
					>
						<select
							aria-label="Publishing"
							value={artifact.publishPolicy ?? FOLLOW}
							disabled={model.mutations.setPublishPolicy.isPending}
							onChange={(event) =>
								model.mutations.setPublishPolicy.mutate({
									publishPolicy: event.target.value === FOLLOW ? null : (event.target.value as PublishPolicy),
								})
							}
							className="w-full border border-line-strong bg-white text-ink"
							style={{ height: 44, padding: "0 12px", fontSize: 15, borderRadius: 12 }}
						>
							<option value={FOLLOW}>
								{artifact.projectId ? "Follow folder" : "Follow default"} ({POLICY_WORD[model.projectPolicy]})
							</option>
							{PUBLISH_POLICY_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</Setting>
				) : null}
			</Body>
		</Sheet>
	)
}

const OPENED_AT = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	month: "short",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
})

/**
 * Owner only: who has opened the file, one row per person served a body read (the viewers aggregate desktop's
 * Viewer activity reads). Mounted only while the step is open, so it asks only then.
 */
const ViewerActivityStep = ({ artifact }: { artifact: VisibleArtifact }) => {
	const viewers = useArtifactViewers(artifact.id)
	const rows = viewers.data ?? []
	return (
		<Sheet title="Viewer activity" sub={artifact.title}>
			<Body>
				{viewers.isPending ? (
					<SheetNote>Loading…</SheetNote>
				) : viewers.isError ? (
					<p role="alert" className="text-muted" style={{ fontSize: 14 }}>
						Could not load who opened it.{" "}
						<button type="button" className="underline" onClick={() => void viewers.refetch()}>
							Retry
						</button>
					</p>
				) : (
					<>
						<Heading>{rows.length} opened</Heading>
						{rows.length === 0 ? (
							<p className="text-muted" style={{ fontSize: 14.5, marginTop: 8 }}>
								Nobody has opened it yet.
							</p>
						) : (
							rows.map((viewer) => (
								<PersonRow
									key={viewer.userId}
									name={viewer.name}
									meta={`${viewer.email} · Last opened ${OPENED_AT.format(new Date(viewer.lastOpenedAt))}`}
								/>
							))
						)}
					</>
				)}
			</Body>
		</Sheet>
	)
}

const ProjectSettingsStep = ({
	projectId,
	projectName,
	model,
}: {
	projectId: string
	projectName: string
	model: ReturnType<typeof useProjectShareModel>
}) => {
	const value = model.project?.linkPreview ?? "metadata"
	return (
		<Sheet title="Sharing settings" sub={projectName}>
			<Body>
				{/* What Slack and other unfurlers show for a pasted link to this Project or the files directly in it;
				    never the body either way. */}
				<Setting
					label="Link previews"
					note={`${
						value === "metadata"
							? "Pasted links show the title to anyone, even without access."
							: "Pasted links show only “A document shared on Exagram”."
					} Applies to this folder and the files directly in it, not subfolders.`}
				>
					<Segmented<LinkPreview>
						label="Link previews"
						options={[
							{ value: "metadata", label: "Show title" },
							{ value: "generic", label: "Hide title" },
						]}
						value={value}
						onChange={(linkPreview) => {
							if (model.setLinkPreview.isPending) return
							model.setLinkPreview.mutate({ projectId, linkPreview })
						}}
					/>
				</Setting>
			</Body>
		</Sheet>
	)
}

const ArtifactShare = ({ artifact }: { artifact: VisibleArtifact }) => {
	const model = useArtifactShareModel(artifact)
	const [step, setStep] = useState<Step>("share")
	const picker = useInvitePicker({
		target: { artifactId: artifact.id },
		ceiling: model.ceiling,
		kind: model.workspace.kind,
		defaultRole: model.defaultRole,
		defaultPinnedRevisionId: model.defaultPinnedRevisionId,
		create: model.create,
	})
	const target = { kind: "artifact", id: artifact.id } as const
	const back = () => {
		picker.reset()
		setStep("share")
	}

	if (step === "invite") {
		const pins = (model.revisions.data ?? [])
			.filter((revision) => revision.status === "approved")
			.map((revision) => ({ id: revision.id, seq: revision.seq }))
			.sort((a, b) => b.seq - a.seq)
		// The starting pin is the visible revision, which the select must offer even before the history loads.
		const visible = artifact.visibleRevisionId
		if (visible && !pins.some((pin) => pin.id === visible)) {
			pins.unshift({ id: visible, seq: artifact.revisionSeq ?? 1 })
		}
		return (
			<InnerStep onBack={back}>
				<InviteStep
					title={artifact.title}
					picker={picker}
					kind={model.workspace.kind}
					workspace={artifact.workspaceName}
					pins={pins}
					onDone={back}
				/>
			</InnerStep>
		)
	}
	if (step === "settings") {
		return (
			<InnerStep onBack={back}>
				<ArtifactSettingsStep artifact={artifact} model={model} />
			</InnerStep>
		)
	}
	if (step === "viewers") {
		return (
			<InnerStep onBack={back}>
				<ViewerActivityStep artifact={artifact} />
			</InnerStep>
		)
	}
	if (step === "anyone" && model.anyone) {
		return (
			<>
				<InnerStep onBack={back}>
					<AnyoneSettingsStep artifact={artifact} anyone={model.anyone} />
				</InnerStep>
				{model.anyone.previewing ? (
					<RecipientPreview artifactId={artifact.id} onExit={model.anyone.endPreview} />
				) : null}
			</>
		)
	}

	return (
		<Sheet title={`Share “${artifact.title}”`}>
			<Body>
				{model.accessPending ? null : (
					<AddPeople canInvite={model.ceiling !== null} why={model.noInvite} onOpen={() => setStep("invite")} />
				)}
				<Heading>People with access</Heading>
				{model.isOwner && model.me.data ? (
					<PersonRow name={model.me.data.name} you meta={model.me.data.email}>
						<RoleText>Owner</RoleText>
					</PersonRow>
				) : (
					<PersonRow name={artifact.ownerName} meta={null}>
						<RoleText>Owner</RoleText>
					</PersonRow>
				)}
				{model.ceiling !== null && model.grants.isPending ? <SheetNote>Loading invited people…</SheetNote> : null}
				{model.ceiling !== null && model.grants.isError ? (
					<p role="alert" className="text-muted" style={{ fontSize: 14 }}>
						Could not load invited people.{" "}
						<button type="button" className="underline" onClick={() => void model.grants.refetch()}>
							Retry
						</button>
					</p>
				) : null}
				{model.viewerNames.map((name, index) => (
					<PersonRow key={`${name}-${index}`} name={name} meta="Invited" />
				))}
				{model.groups.map((grant) => (
					<PersonRow
						key={grant.id}
						name={grant.granteeName}
						meta={groupLine(grant.grantee.memberCount)}
						avatar={<GroupAvatar />}
					>
						<GranteeRole grant={grant} kind={model.workspace.kind} canManage={model.isOwner} target={target} />
					</PersonRow>
				))}
				{model.members.map((grant) => (
					<PersonRow key={grant.id} name={grant.granteeName} meta={model.metaOf(grant)}>
						<GranteeRole grant={grant} kind={model.workspace.kind} canManage={model.isOwner} target={target} />
					</PersonRow>
				))}
				<InvitedSection
					invited={model.invited}
					kind={model.workspace.kind}
					canManage={model.isOwner}
					target={target}
					linkUrl={model.ceiling === null ? null : model.url}
				/>
				{model.ceiling === null || model.grants.isSuccess ? (
					<p className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.45, marginTop: 4 }}>
						{model.note}
					</p>
				) : null}
				<GeneralAccessSection
					artifact={artifact}
					isOwner={model.isOwner}
					variant="mobile"
					anyone={model.anyone}
					mutation={model.generalAccess}
				/>
				{model.isOwner && artifact.generalAccess === "anyone" && model.anyone ? (
					<AnyoneSettingsRow anyone={model.anyone} onOpen={() => setStep("anyone")} />
				) : null}
				{model.isOwner ? (
					<>
						<SettingsRow
							value={
								artifact.defaultPin === "latest"
									? "New people see Latest"
									: `New people see v${artifact.revisionSeq ?? 1}`
							}
							onOpen={() => setStep("settings")}
						/>
						{/* Desktop's header button beside the gear; here, the row under Sharing settings. */}
						<div style={{ margin: "0 -10px" }}>
							<SheetRow
								icon={<IconEye size={17} />}
								label="Viewer activity"
								chevron
								onClick={() => setStep("viewers")}
							/>
						</div>
					</>
				) : null}
			</Body>
			<Footer url={model.url} copiedMessage={generalAccessCopied(artifact)} />
		</Sheet>
	)
}

const ProjectShare = ({ projectId, projectName }: { projectId: string; projectName: string }) => {
	const model = useProjectShareModel(projectId)
	const [step, setStep] = useState<Step>("share")
	const picker = useInvitePicker({
		target: { projectId },
		ceiling: model.ceiling,
		kind: model.workspace.kind,
		defaultRole: model.defaultRole,
		create: model.create,
	})
	const target = { kind: "project", id: projectId } as const
	const back = () => {
		picker.reset()
		setStep("share")
	}

	if (step === "invite") {
		return (
			<InnerStep onBack={back}>
				<InviteStep
					title={projectName}
					picker={picker}
					kind={model.workspace.kind}
					workspace={model.me.data?.workspaceName ?? "the workspace"}
					pins={[]}
					onDone={back}
				/>
			</InnerStep>
		)
	}
	if (step === "settings") {
		return (
			<InnerStep onBack={back}>
				<ProjectSettingsStep projectId={projectId} projectName={projectName} model={model} />
			</InnerStep>
		)
	}

	return (
		<Sheet title={`Share “${projectName}”`} sub={model.fileCount === 1 ? "1 file" : `${model.fileCount} files`}>
			<Body>
				{/* Nothing reads as Owner or not until the server has said which this person is. */}
				{model.access.isPending ? (
					<SheetNote>Loading…</SheetNote>
				) : (
					<>
						<AddPeople canInvite={model.ceiling !== null} why={model.noInvite} onOpen={() => setStep("invite")} />
						{model.ceiling === null ? null : (
							<>
								<Heading>People with access</Heading>
								{model.isOwner && model.me.data ? (
									<PersonRow name={model.me.data.name} you meta={model.me.data.email}>
										<RoleText>Owner</RoleText>
									</PersonRow>
								) : null}
								{model.groups.map((grant) => (
									<PersonRow
										key={grant.id}
										name={grant.granteeName}
										meta={groupLine(grant.grantee.memberCount)}
										avatar={<GroupAvatar />}
									>
										<GranteeRole grant={grant} kind={model.workspace.kind} canManage={model.isOwner} target={target} />
									</PersonRow>
								))}
								{model.members.map((grant) => (
									<PersonRow key={grant.id} name={grant.granteeName} meta={grant.granteeEmail}>
										<GranteeRole grant={grant} kind={model.workspace.kind} canManage={model.isOwner} target={target} />
									</PersonRow>
								))}
								<InvitedSection
									invited={model.invited}
									kind={model.workspace.kind}
									canManage={model.isOwner}
									target={target}
									linkUrl={model.ceiling === null ? null : model.url}
								/>
							</>
						)}
						{model.isOwner && model.project && model.workspace.kind === "team" ? (
							<SettingsRow
								value={model.project.linkPreview === "metadata" ? "Previews show title" : "Previews hide title"}
								onOpen={() => setStep("settings")}
							/>
						) : null}
					</>
				)}
			</Body>
			<Footer url={model.url} />
		</Sheet>
	)
}

const ArtifactShareSheet = ({ artifactId }: { artifactId: string }) => {
	const { artifact, loading } = useSheetArtifact(artifactId)
	if (loading) return <SheetLoading title="Share" />
	if (!artifact) return <SheetGone />
	return <ArtifactShare artifact={artifact} />
}

const ProjectShareSheet = ({ projectId }: { projectId: string }) => {
	const projects = useProjects()
	const project = (projects.data ?? []).find((candidate) => candidate.id === projectId)
	if (projects.isPending) return <SheetLoading title="Share" />
	if (!project) {
		return (
			<Sheet title="Folder unavailable">
				<SheetNote>This folder was deleted or is no longer shared with you.</SheetNote>
			</Sheet>
		)
	}
	return <ProjectShare projectId={project.id} projectName={project.name} />
}

/**
 * Share (core `kind === "share"`; v3.8) for a file or a Project: Add people opens the Invite step,
 * then people with access and Invited · N (Copy link to send them; the Owner changes a role or cancels in the
 * Role drawer), Sharing settings for the Owner, Copy link and Done. The same grants and gates as the desktop
 * Share dialog, through `useShareModel` and `useInvitePicker`.
 */
const ShareSheet = ({ params }: { params: SheetParams["share"] }) =>
	params.target.kind === "artifact" ? (
		<ArtifactShareSheet artifactId={params.target.id} />
	) : (
		<ProjectShareSheet projectId={params.target.id} />
	)

export default ShareSheet
