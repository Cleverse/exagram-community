import {
	type Grant,
	type GrantRole,
	type LinkPreview,
	type PublishPolicy,
	type VisibleArtifact,
	type WorkspaceKind,
} from "@exagram/api-client"
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react"

import { Dialog } from "@/components/Dialog"
import { useToast } from "@/components/Toast"
import { IconButton } from "@/components/ui/IconButton"
import {
	IconCheck,
	IconChevronDown,
	IconChevronLeft,
	IconClose,
	IconExternal,
	IconEye,
	IconGear,
	IconLink,
	IconMail,
	IconUpload,
	IconWarning,
} from "@/components/ui/icons"
import { Switch } from "@/components/ui/Switch"
import { edition } from "@/edition/edition"
import { useArtifactViewers } from "@/features/artifact/hooks/useLedger"
import { generalAccessCopied } from "@/features/grants/general-access/generalAccess"
import { GeneralAccessSection } from "@/features/grants/general-access/GeneralAccessSection"
import { type InviteInput } from "@/features/grants/hooks/useGrants"
import { PinMenu } from "@/features/grants/PinMenu"
import { HEADING, MONO, Round } from "@/features/grants/shareParts"
import { NEEDS_JOIN_LINK } from "@/features/grants/sheets/inviteLink"
import { type InviteChip, inviteToast, useInvitePicker } from "@/features/grants/useInvitePicker"
import {
	copyShareLink,
	initialsOf,
	emptyChecklistNote,
	INVITED_META,
	invitePlaceholder,
	newPersonCopy,
	roleLabel,
	rolesFor,
	shownRole,
	useArtifactShareModel,
	useProjectShareModel,
} from "@/features/grants/useShareModel"
import { LinkDialog } from "@/features/links/LinkDialog"
import { PUBLISH_POLICY_OPTIONS } from "@/features/project/publishPolicy"

const META = { fontSize: 13, color: "var(--color-muted)", marginTop: 2 } as const

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
const pad = (value: number) => String(value).padStart(2, "0")

/** "24 SEP 2026 · 17:35", as the Share design writes an open time. */
const formatOpened = (value: Date | string) => {
	const date = value instanceof Date ? value : new Date(value)
	return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()} · ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A person's avatar tint, picked from their initials so one person keeps one colour. */
const TINTS = [
	["var(--color-subtle)", "var(--color-secondary)"],
	["var(--color-blue-bg)", "var(--color-blue-fg)"],
	["var(--color-orange-bg)", "var(--color-orange-fg)"],
	["var(--color-green-bg)", "var(--color-green-fg)"],
] as const
const tintOf = (name: string) => TINTS[initialsOf(name).charCodeAt(0) % TINTS.length] ?? TINTS[0]

const PersonAvatar = ({ name, size = 34 }: { name: string; size?: number }) => {
	const [background, color] = tintOf(name)
	return (
		<Round size={size} background={background} color={color}>
			{initialsOf(name)}
		</Round>
	)
}

/** Borderless text with a chevron: v3.8's row role select, and the pin and role inside the invite input. */
const InlineSelect = ({
	label,
	value,
	onChange,
	disabled,
	fontSize = 15,
	color = "var(--color-secondary)",
	children,
}: {
	label: string
	value: string
	onChange: (value: string) => void
	disabled?: boolean
	fontSize?: number
	color?: string
	children: ReactNode
}) => (
	<div className="relative inline-flex flex-none items-center">
		<select
			aria-label={label}
			value={value}
			disabled={disabled}
			onChange={(event) => onChange(event.target.value)}
			className="bg-transparent hover:bg-row-selected"
			style={{
				appearance: "none",
				height: 32,
				padding: "0 26px 0 10px",
				borderRadius: 8,
				border: 0,
				fontSize,
				color,
				cursor: "pointer",
				outline: 0,
			}}
		>
			{children}
		</select>
		<IconChevronDown
			size={14}
			className="pointer-events-none absolute"
			style={{ right: 8, color: "var(--color-muted)" }}
		/>
	</div>
)

export const RoleSelect = ({
	label,
	value,
	options,
	onChange,
	fontSize,
	color,
}: {
	label: string
	value: GrantRole
	options: readonly GrantRole[]
	onChange: (role: GrantRole) => void
	fontSize?: number
	color?: string
}) => (
	<InlineSelect
		label={label}
		value={value}
		onChange={(next) => onChange(next as GrantRole)}
		fontSize={fontSize}
		color={color}
	>
		{options.map((role) => (
			<option key={role} value={role}>
				{roleLabel(role)}
			</option>
		))}
	</InlineSelect>
)

const roundButton: CSSProperties = { borderRadius: "50%", color: "var(--color-secondary)" }

/**
 * A header icon button's popover: Sharing settings, and the Owner's Viewer activity. Closes on a click outside it
 * or on its button again. The content mounts only while open, so what it fetches waits until then.
 */
const HeaderPopover = ({
	label,
	icon,
	width = 360,
	children,
}: {
	label: string
	icon: ReactNode
	width?: number
	children: ReactNode
}) => {
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return
		const onDown = (event: MouseEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
		}
		document.addEventListener("mousedown", onDown)
		return () => document.removeEventListener("mousedown", onDown)
	}, [open])

	return (
		<div ref={ref} className="relative">
			<IconButton
				size={36}
				aria-label={label}
				title={label}
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
				style={{ ...roundButton, background: open ? "var(--color-hover)" : undefined }}
			>
				{icon}
			</IconButton>
			{open ? (
				<div
					role="dialog"
					aria-label={label}
					className="absolute"
					style={{
						right: 0,
						top: 44,
						zIndex: 6,
						width,
						maxHeight: 420,
						overflowY: "auto",
						background: "var(--color-panel)",
						border: "1px solid var(--color-line)",
						borderRadius: 12,
						boxShadow: "var(--shadow-menu)",
						padding: 16,
						animation: "fadeUp 200ms var(--ease-arrive)",
					}}
				>
					{children}
				</div>
			) : null}
		</div>
	)
}

/** A setting row: a round icon, a title and a line under it, and its control. */
const SettingRow = ({
	icon,
	title,
	description,
	children,
	below,
	marginTop = 0,
}: {
	icon: ReactNode
	title: ReactNode
	description: ReactNode
	children?: ReactNode
	/** A control too wide to sit beside the text, such as Publishing's select. */
	below?: ReactNode
	marginTop?: number
}) => (
	<div className="flex items-start" style={{ gap: 12, marginTop }}>
		<Round size={34}>{icon}</Round>
		<div className="min-w-0 flex-1">
			<div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
			<div style={{ fontSize: 14, color: "var(--color-secondary)", marginTop: 2, lineHeight: 1.5 }}>{description}</div>
			{below ? <div style={{ marginTop: 4, marginLeft: -10 }}>{below}</div> : null}
		</div>
		{children}
	</div>
)

/**
 * The Share dialog's frame (v3.8): white, 16px radius, 640px. A fixed header or the Invite view's own top, a
 * scrolling middle, and a sticky footer, so a long guest list never pushes Done off screen.
 */
const ShareFrame = ({ onClose, children }: { onClose: () => void; children: ReactNode }) => (
	<Dialog
		ariaLabel="Share"
		onClose={onClose}
		width={640}
		bare
		surface="var(--color-panel)"
		cardStyle={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 16, border: 0 }}
	>
		{children}
	</Dialog>
)

/** Step 1: who has access and the footer; the input opens the Invite view. */
const PeopleStep = ({
	title,
	subtitle,
	settings,
	activity,
	onClose,
	children,
	footer,
}: {
	title: string
	subtitle: string
	/** The Sharing settings popover's rows; no gear without them. */
	settings?: ReactNode
	/** The Owner's Viewer activity, behind its own header button. */
	activity?: ReactNode
	onClose: () => void
	children: ReactNode
	footer: ReactNode
}) => (
	<>
		<div className="flex flex-none items-start justify-between" style={{ gap: 12, padding: "32px 32px 0" }}>
			<div className="min-w-0">
				<h2 className="font-display" style={{ fontWeight: 600, fontSize: 22, letterSpacing: "-.01em" }}>
					{title}
				</h2>
				<div className="truncate" style={{ fontSize: 14, color: "var(--color-muted)", marginTop: 4 }}>
					{subtitle}
				</div>
			</div>
			<div className="flex flex-none items-center" style={{ gap: 4 }}>
				{activity ? (
					<HeaderPopover label="Viewer activity" icon={<IconEye size={18} />} width={440}>
						{activity}
					</HeaderPopover>
				) : null}
				{settings ? (
					<HeaderPopover label="Sharing settings" icon={<IconGear size={18} />}>
						<div style={{ ...HEADING, marginBottom: 12 }}>Sharing settings</div>
						{settings}
					</HeaderPopover>
				) : null}
				<IconButton size={36} aria-label="Close" onClick={onClose} style={roundButton}>
					<IconClose size={18} />
				</IconButton>
			</div>
		</div>
		<div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "0 32px 20px" }}>
			{children}
		</div>
		<div
			className="flex flex-none flex-wrap items-center justify-between"
			style={{ gap: 12, padding: "12px 32px 28px", background: "var(--color-panel)" }}
		>
			<div className="flex flex-wrap items-center" style={{ gap: 16, fontSize: 15, fontWeight: 500 }}>
				{footer}
			</div>
			<button
				type="button"
				onClick={onClose}
				className="bg-primary text-white hover:bg-primary-hover press"
				style={{ height: 48, padding: "0 24px", borderRadius: 14, fontSize: 16, fontWeight: 600 }}
			>
				Done
			</button>
		</div>
	</>
)

const CopyLinkButton = ({ url, copiedMessage }: { url: string; copiedMessage?: string }) => {
	const toast = useToast()
	return (
		<button
			type="button"
			className="press flex items-center whitespace-nowrap hover:bg-ground"
			style={{
				gap: 8,
				height: 48,
				padding: "0 20px",
				border: "1px solid var(--color-line-segment)",
				borderRadius: 14,
				background: "var(--color-panel)",
				fontSize: 15,
				fontWeight: 600,
				color: "var(--color-ink)",
			}}
			onClick={() => void copyShareLink(url, toast, copiedMessage)}
		>
			<IconLink size={17} />
			Copy link
		</button>
	)
}

const AddPeopleInput = ({ canInvite, why, onOpen }: { canInvite: boolean; why: string | null; onOpen: () => void }) =>
	canInvite ? (
		<input
			aria-label="Add people by name or email"
			placeholder="Add people by name or email"
			readOnly
			onClick={onOpen}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown") return
				event.preventDefault()
				onOpen()
			}}
			className="w-full"
			style={{
				marginTop: 22,
				height: 52,
				border: "1px solid var(--color-line-segment)",
				borderRadius: 12,
				background: "var(--color-panel)",
				padding: "0 18px",
				fontSize: 16,
				outline: 0,
			}}
		/>
	) : why === null ? null : (
		<div style={{ fontSize: 15, color: "var(--color-secondary)", marginTop: 22 }}>{why}</div>
	)

const PersonRow = ({
	name,
	meta,
	avatar,
	children,
}: {
	name: string
	meta?: ReactNode
	avatar?: ReactNode
	children?: ReactNode
}) => (
	<div className="flex items-center" style={{ gap: 14, padding: "8px 0" }}>
		{avatar ?? <PersonAvatar name={name} />}
		<div className="min-w-0 flex-1">
			<div className="truncate" style={{ fontSize: 16 }}>
				{name}
			</div>
			{meta ? (
				<div className="truncate" style={META}>
					{meta}
				</div>
			) : null}
		</div>
		{children}
	</div>
)

/** The Owner row: the email only under the name, and "Owner" as gray text (v3.8 §2). */
const OwnerRow = ({ name, email }: { name: string; email: string | null }) => (
	<PersonRow name={name} meta={email}>
		<div className="flex-none" style={{ fontSize: 15, color: "var(--color-dark-faint)", paddingRight: 10 }}>
			Owner
		</div>
	</PersonRow>
)

const RemoveButton = ({ label, title, onClick }: { label: string; title: string; onClick: () => void }) => (
	<button
		type="button"
		title={title}
		aria-label={label}
		onClick={onClick}
		className="grid flex-none place-items-center text-muted-2 hover:bg-hover hover:text-ink"
		style={{ width: 30, height: 30, borderRadius: "50%" }}
	>
		<IconClose size={14} />
	</button>
)

/** Only the Owner changes a role or removes someone; everyone else reads the role as text. */
const GranteeControls = ({
	grant,
	kind,
	canManage,
	onRole,
	onRemove,
	removeTitle = "Remove access",
	pin,
	lead,
}: {
	grant: Grant
	kind: WorkspaceKind
	canManage: boolean
	onRole: (role: GrantRole) => void
	onRemove: () => void
	removeTitle?: string
	pin?: ReactNode
	/** Before the role: an Invited row's Copy link. */
	lead?: ReactNode
}) => (
	<div className="flex flex-none items-center" style={{ gap: 4 }}>
		{lead}
		{canManage ? (
			<>
				{pin}
				<RoleSelect
					label={`Role for ${grant.granteeName}`}
					value={shownRole(kind, grant.role)}
					options={rolesFor(kind)}
					onChange={onRole}
				/>
				<RemoveButton label={`${removeTitle} for ${grant.granteeName}`} title={removeTitle} onClick={onRemove} />
			</>
		) : (
			<div style={{ fontSize: 15, color: "var(--color-secondary)", padding: "0 10px" }}>{roleLabel(grant.role)}</div>
		)}
	</div>
)

/**
 * An Invited row's "Copy link": Exagram sends no email, so the sharer sends it. `?invited=1` lets the sign-in page
 * greet them as someone invited.
 */
const CopyInviteLink = ({ email, url }: { email: string; url: string }) => {
	const toast = useToast()
	const copyable = edition.useInviteLinkCopyable()
	if (!copyable) return null
	return (
		<button
			type="button"
			title="Copy invite link"
			className="press grid flex-none place-items-center text-muted-2 hover:bg-hover hover:text-ink"
			style={{ width: 30, height: 30, borderRadius: "50%" }}
			aria-label={`Copy link for ${email}`}
			onClick={() =>
				void navigator.clipboard.writeText(`${url}?invited=1`).then(
					() => toast(`Link copied — send it to ${email}`),
					() => toast("Could not copy — select the URL and copy it"),
				)
			}
		>
			<IconLink size={15} />
		</button>
	)
}

const InvitedSection = ({
	invited,
	renderControls,
}: {
	invited: Grant[]
	renderControls: (grant: Grant) => ReactNode
}) => {
	const copyable = edition.useInviteLinkCopyable()
	return invited.length === 0 ? null : (
		<section aria-label="Invited">
			<div className="flex items-baseline justify-between" style={{ gap: 12, marginTop: 22 }}>
				<div style={HEADING}>Invited · {invited.length}</div>
				<div style={{ fontSize: 13, color: "var(--color-muted)" }}>Access starts at first sign-in</div>
			</div>
			<div className="flex flex-col" style={{ gap: 4, marginTop: 10 }}>
				{invited.map((grant) => (
					<PersonRow
						key={grant.id}
						name={grant.granteeEmail}
						meta={copyable ? INVITED_META : NEEDS_JOIN_LINK}
						avatar={
							<Round size={34} dashed>
								<IconMail size={17} />
							</Round>
						}
					>
						{renderControls(grant)}
					</PersonRow>
				))}
			</div>
		</section>
	)
}

/**
 * Who has opened the file: one row per person served a body read, from the Owner-only viewers
 * aggregate, so a Project-level grantee shows up and a long Ledger never truncates the list.
 * It lives in the header's Viewer activity popover and asks only once that opens.
 */
const ViewerActivity = ({ artifactId }: { artifactId: string }) => {
	const viewers = useArtifactViewers(artifactId)
	const rows = viewers.data ?? []

	return (
		<>
			<div className="flex items-baseline justify-between" style={{ gap: 12 }}>
				<div style={HEADING}>Viewer activity</div>
				<div style={{ fontSize: 13, color: "var(--color-muted)" }}>{rows.length} opened</div>
			</div>
			{viewers.isLoading ? null : rows.length === 0 ? (
				<div style={{ fontSize: 15, color: "var(--color-secondary)", marginTop: 12 }}>Nobody has opened it yet.</div>
			) : (
				<div className="flex flex-col" style={{ gap: 4, marginTop: 10 }}>
					{rows.map((viewer) => (
						<PersonRow key={viewer.userId} name={viewer.name} meta={viewer.email}>
							<div
								className="flex-none text-right"
								style={{ fontFamily: MONO, fontSize: 12, color: "var(--color-muted)", lineHeight: 1.6 }}
							>
								<div>First opened {formatOpened(viewer.firstOpenedAt)}</div>
								<div>Last opened {formatOpened(viewer.lastOpenedAt)}</div>
							</div>
						</PersonRow>
					))}
				</div>
			)}
		</>
	)
}

const POLICY_WORD: Record<PublishPolicy, string> = { auto: "Automatic", manual: "Manual" }
const FOLLOW = "follow"

/** Owner only, in Sharing settings: the file's own publish policy, or follow its Project's. */
const PublishingRow = ({
	artifact,
	projectPolicy,
	pending,
	onChange,
}: {
	artifact: VisibleArtifact
	projectPolicy: PublishPolicy
	pending: boolean
	onChange: (publishPolicy: PublishPolicy | null) => void
}) => (
	<SettingRow
		marginTop={18}
		icon={<IconUpload size={17} />}
		title="Publishing"
		description={
			artifact.effectivePublishPolicy === "auto"
				? "Owner and Editor uploads go live right away"
				: "Every new version waits for your approval"
		}
		below={
			<InlineSelect
				label="Publishing"
				value={artifact.publishPolicy ?? FOLLOW}
				disabled={pending}
				onChange={(value) => onChange(value === FOLLOW ? null : (value as PublishPolicy))}
				fontSize={14}
			>
				<option value={FOLLOW}>
					{artifact.projectId ? "Follow project" : "Follow default"} ({POLICY_WORD[projectPolicy]})
				</option>
				{PUBLISH_POLICY_OPTIONS.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</InlineSelect>
		}
	/>
)

/**
 * Owner only, in Sharing settings: what Slack and other unfurlers show for a pasted link to this Project or the
 * files directly in it; a sub-project keeps its own setting. Never the body either way (ADR 0019).
 */
const LinkPreviewRow = ({
	value,
	pending,
	onChange,
}: {
	value: LinkPreview
	pending: boolean
	onChange: (linkPreview: LinkPreview) => void
}) => (
	<SettingRow
		icon={<IconExternal size={17} />}
		title="Link previews"
		description={
			<>
				{value === "metadata"
					? "Pasted links show the title to anyone, even without access."
					: "Pasted links show only “Exagram” to people without access."}{" "}
				Applies to this project and the files directly in it, not sub-projects.
			</>
		}
	>
		<Switch
			label="Show title in link previews"
			checked={value === "metadata"}
			onChange={(on) => {
				if (!pending) onChange(on ? "metadata" : "generic")
			}}
		/>
	</SettingRow>
)

/** Owner only, in Sharing settings: which version someone newly shared with sees. */
const DefaultPinRow = ({
	artifact,
	pending,
	onChange,
}: {
	artifact: VisibleArtifact
	pending: boolean
	onChange: (defaultPin: VisibleArtifact["defaultPin"]) => void
}) => (
	<SettingRow
		icon={<IconLink size={17} />}
		title="New people see"
		description="The version someone you share with next opens."
	>
		<InlineSelect
			label="Default pin"
			value={artifact.defaultPin}
			disabled={pending}
			onChange={(value) => onChange(value as VisibleArtifact["defaultPin"])}
			fontSize={14}
		>
			<option value="latest">Latest</option>
			<option value="current">v{artifact.revisionSeq ?? 1} only</option>
		</InlineSelect>
	</SettingRow>
)

const LATEST = "latest"

const Chip = ({
	chip,
	failure,
	newLabel,
	onRemove,
}: {
	chip: InviteChip
	failure: string | undefined
	newLabel: string
	onRemove: () => void
}) => {
	const [background, color] = tintOf(chip.name)
	return (
		<div
			title={failure ?? (chip.isNew ? newLabel : chip.email)}
			className="flex items-center"
			style={{
				gap: 7,
				height: 32,
				padding: "0 6px",
				borderRadius: 16,
				background: failure ? "var(--color-danger-bg)" : chip.isNew ? "var(--color-panel)" : "var(--color-subtle)",
				border: failure
					? "1px solid var(--color-danger)"
					: chip.isNew
						? "1px dashed var(--color-path-slash)"
						: "1px solid transparent",
				color: failure ? "var(--color-danger)" : "var(--color-ink)",
				fontSize: 14,
				fontWeight: 500,
				maxWidth: "100%",
			}}
		>
			{failure ? (
				<IconWarning size={16} />
			) : chip.isNew ? (
				<Round size={22} dashed>
					<IconMail size={12} />
				</Round>
			) : (
				<Round size={22} background={background} color={color}>
					{initialsOf(chip.name)}
				</Round>
			)}
			<span className="truncate">{chip.isNew ? chip.email : chip.name}</span>
			{failure ? <span className="sr-only">: {failure}</span> : null}
			<button
				type="button"
				aria-label={`Remove ${chip.email}`}
				onClick={onRemove}
				className="grid flex-none place-items-center hover:bg-line-strong"
				style={{ width: 18, height: 18, borderRadius: "50%", color: "var(--color-secondary)" }}
			>
				<IconClose size={11} />
			</button>
		</div>
	)
}

const CheckCircle = ({ checked }: { checked: boolean }) => (
	<div
		className="grid flex-none place-items-center"
		style={{
			width: 22,
			height: 22,
			borderRadius: "50%",
			background: checked ? "var(--color-ink)" : "transparent",
			border: `1.5px solid ${checked ? "var(--color-ink)" : "var(--color-line-segment)"}`,
			color: "white",
		}}
	>
		{checked ? <IconCheck size={12} strokeWidth={3} /> : null}
	</div>
)

const NewBadge = ({ label }: { label: string }) => (
	<span
		className="inline-flex flex-none items-center"
		style={{
			height: 20,
			padding: "0 7px",
			borderRadius: 10,
			background: "var(--color-pending-bg)",
			color: "var(--color-pending-fg)",
			fontSize: 12,
			fontWeight: 500,
		}}
	>
		{label}
	</span>
)

const ListHeading = ({ children }: { children: ReactNode }) => (
	<div style={{ padding: "12px 12px 4px", fontSize: 13, color: "var(--color-dark-faint)" }}>{children}</div>
)

const ChecklistRow = ({
	name,
	meta,
	avatar,
	badge,
	checked,
	onToggle,
	action = false,
	label,
}: {
	name: string
	meta: string
	avatar: ReactNode
	badge?: ReactNode
	checked: boolean
	onToggle: () => void
	/** The "Invite {email}" row is an action, not a checkbox. */
	action?: boolean
	label?: string
}) => (
	<button
		type="button"
		role={action ? undefined : "checkbox"}
		aria-checked={action ? undefined : checked}
		aria-label={label}
		onClick={onToggle}
		className="flex w-full items-center text-left hover:bg-row-hover"
		style={{
			gap: 14,
			padding: "10px 12px",
			borderRadius: 12,
			background: checked ? "var(--color-row-hover)" : undefined,
		}}
	>
		{avatar}
		<div className="min-w-0 flex-1">
			<div className="flex min-w-0 items-center" style={{ gap: 8 }}>
				<span className="truncate" style={{ fontSize: 15, fontWeight: 500 }}>
					{name}
				</span>
				{badge}
			</div>
			<div className="truncate" style={META}>
				{meta}
			</div>
		</div>
		{action ? null : <CheckCircle checked={checked} />}
	</button>
)

type Revision = { id: string; seq: number; status: string }

/**
 * v3.8's Invite view: chips with the pin and role inside the input and an Invite button, and a checklist the text
 * filters. Back discards what was picked; a clean submit returns to step 1.
 */
const InviteView = ({
	subtitle,
	target,
	ceiling,
	kind,
	workspaceName,
	defaultPinnedRevisionId,
	revisions,
	create,
	onBack,
}: {
	subtitle: string
	target: { artifactId: string } | { projectId: string }
	ceiling: GrantRole | null
	kind: WorkspaceKind
	workspaceName: string
	defaultPinnedRevisionId?: string | null
	revisions: Revision[]
	create: (input: InviteInput) => Promise<Grant>
	onBack: () => void
}) => {
	const toast = useToast()
	const picker = useInvitePicker({ target, ceiling, kind, defaultPinnedRevisionId, create })
	const copy = newPersonCopy(kind, workspaceName)
	const needle = picker.text.trim().toLowerCase()
	const candidateEmails = new Set(picker.candidates.map((candidate) => candidate.email.toLowerCase()))
	// Typed addresses picked as chips stay in the list, ticked, so they can be unticked here too.
	const typedNew = picker.chips.filter(
		(chip) => chip.isNew && !candidateEmails.has(chip.email.toLowerCase()) && chip.email.toLowerCase().includes(needle),
	)
	const hasNewRows = picker.newEmail !== null || typedNew.length > 0
	const approved = revisions.filter((revision) => revision.status === "approved")
	const pinValue = picker.pinnedRevisionId ?? LATEST

	const back = () => {
		picker.reset()
		onBack()
	}

	const submit = async () => {
		const { created, failed } = await picker.submit()
		const failedNote =
			failed.length === 0
				? null
				: failed.length === 1
					? `${failed[0]?.email}: ${failed[0]?.error}`
					: `Could not invite ${failed.length} people.`
		const parts = [created.length > 0 ? inviteToast(created) : null, failedNote].filter(Boolean)
		if (parts.length > 0) toast(parts.join(" "))
		if (failed.length === 0 && created.length > 0) onBack()
	}

	return (
		<div className="flex flex-col" style={{ height: "min(680px, calc(100vh - 48px))" }}>
			<div
				className="flex flex-none items-center"
				style={{ gap: 10, padding: "18px 20px", borderBottom: "1px solid var(--color-row-line)" }}
			>
				<IconButton
					size={36}
					aria-label="Back"
					title="Back"
					onClick={back}
					style={{ ...roundButton, color: "var(--color-ink)" }}
				>
					<IconChevronLeft size={18} />
				</IconButton>
				<div className="min-w-0 flex-1">
					<h2 className="font-display" style={{ fontWeight: 600, fontSize: 18 }}>
						Invite
					</h2>
					<div className="truncate" style={{ fontSize: 13, color: "var(--color-muted)", marginTop: 1 }}>
						{subtitle}
					</div>
				</div>
			</div>

			<div className="flex flex-none items-start" style={{ gap: 10, padding: "18px 20px 12px" }}>
				<div
					className="flex min-w-0 flex-1 items-start"
					style={{
						gap: 8,
						minHeight: 52,
						padding: "8px 8px 8px 10px",
						border: "1px solid var(--color-secondary)",
						borderRadius: 12,
						background: "var(--color-panel)",
						boxShadow: "0 0 0 3px var(--color-subtle)",
					}}
				>
					<div className="flex min-w-0 flex-1 flex-wrap items-center" style={{ gap: 6 }}>
						{picker.chips.map((chip) => (
							<Chip
								key={chip.email}
								chip={chip}
								failure={picker.failures[chip.email]}
								newLabel={copy.badge}
								onRemove={() => picker.remove(chip.email)}
							/>
						))}
						<input
							aria-label="Add people by name or email"
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
							placeholder={invitePlaceholder(kind, "dialog", picker.chips.length)}
							className="min-w-0 flex-1"
							style={{ minWidth: 140, height: 32, border: 0, outline: 0, background: "transparent", fontSize: 15 }}
						/>
					</div>
					<div className="flex flex-none items-center" style={{ gap: 2 }}>
						{picker.showPin ? (
							<InlineSelect
								label="Version they see"
								value={pinValue}
								onChange={(value) => picker.setPinnedRevisionId(value === LATEST ? null : value)}
								fontSize={14}
								color="var(--color-muted)"
							>
								<option value={LATEST}>Latest</option>
								{approved.map((revision) => (
									<option key={revision.id} value={revision.id}>
										v{revision.seq} only
									</option>
								))}
								{pinValue !== LATEST && !approved.some((revision) => revision.id === pinValue) ? (
									<option value={pinValue}>This version only</option>
								) : null}
							</InlineSelect>
						) : null}
						<RoleSelect
							label="Invite as"
							value={picker.role}
							options={picker.options}
							onChange={picker.setRole}
							fontSize={14}
							color="var(--color-muted)"
						/>
					</div>
				</div>
				<button
					type="button"
					disabled={!picker.canSubmit}
					onClick={() => void submit()}
					className="press flex-none"
					style={{
						height: 52,
						padding: "0 22px",
						borderRadius: 12,
						background: picker.canSubmit ? "var(--color-primary)" : "var(--color-row-selected)",
						color: picker.canSubmit ? "white" : "var(--color-dark-faint)",
						fontSize: 15,
						fontWeight: 600,
						cursor: picker.canSubmit ? "pointer" : "default",
					}}
				>
					Invite
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "0 8px 8px" }}>
				{picker.newEmail ? (
					<>
						<ListHeading>{copy.heading}</ListHeading>
						<ChecklistRow
							action
							label={`Invite ${picker.newEmail}`}
							name={`Invite ${picker.newEmail}`}
							meta={copy.row}
							avatar={
								<Round size={40} dashed>
									<IconMail size={17} />
								</Round>
							}
							checked={false}
							onToggle={picker.addNewEmail}
						/>
					</>
				) : null}
				{typedNew.map((chip) => (
					<ChecklistRow
						key={chip.email}
						name={chip.email}
						meta="Send them the link after inviting"
						badge={<NewBadge label={copy.badge} />}
						avatar={
							<Round size={40} dashed>
								<IconMail size={17} />
							</Round>
						}
						checked
						onToggle={() => picker.remove(chip.email)}
					/>
				))}
				{hasNewRows && picker.candidates.length > 0 ? <ListHeading>People</ListHeading> : null}
				{picker.candidates.map((candidate) => (
					<ChecklistRow
						key={candidate.id}
						name={candidate.name}
						meta={candidate.email}
						badge={candidate.pending ? <NewBadge label={copy.badge} /> : null}
						avatar={
							candidate.pending ? (
								<Round size={40} dashed>
									<IconMail size={17} />
								</Round>
							) : (
								<PersonAvatar name={candidate.name} size={40} />
							)
						}
						checked={candidate.selected}
						onToggle={() => picker.toggle(candidate)}
					/>
				))}
				{!hasNewRows && picker.candidates.length === 0 ? (
					<div style={{ padding: "18px 12px", fontSize: 14, color: "var(--color-muted)" }}>
						{emptyChecklistNote(kind, picker.text.trim())}
					</div>
				) : null}
			</div>
		</div>
	)
}

const ArtifactSharePanel = ({ artifact, onClose }: { artifact: VisibleArtifact; onClose: () => void }) => {
	const {
		me,
		isOwner,
		ceiling,
		workspace,
		noInvite,
		accessPending,
		grants,
		revisions,
		mutations,
		anyone,
		generalAccess,
		members,
		invited,
		defaultPinnedRevisionId,
		create,
		viewerNames,
		note,
		metaOf,
		projectPolicy,
		url,
	} = useArtifactShareModel(artifact)
	const { kind } = workspace
	const [linkOpen, setLinkOpen] = useState(false)
	const [inviting, setInviting] = useState(false)
	const subtitle = `${artifact.title} · v${artifact.revisionSeq ?? 1}`
	const workspaceName = artifact.workspaceName

	const pinFor = (grant: Grant) => (
		<PinMenu
			revisions={revisions.data ?? []}
			pinnedRevisionId={grant.pinnedRevisionId}
			disabled={mutations.setPin.isPending}
			onChange={(pinnedRevisionId) => mutations.setPin.mutate({ grantId: grant.id, pinnedRevisionId })}
		/>
	)

	return (
		<>
			<ShareFrame onClose={onClose}>
				{inviting ? (
					<InviteView
						subtitle={subtitle}
						target={{ artifactId: artifact.id }}
						ceiling={ceiling}
						kind={kind}
						workspaceName={workspaceName}
						defaultPinnedRevisionId={defaultPinnedRevisionId}
						revisions={revisions.data ?? []}
						create={create}
						onBack={() => setInviting(false)}
					/>
				) : (
					<PeopleStep
						title="Share file"
						subtitle={subtitle}
						onClose={onClose}
						activity={isOwner ? <ViewerActivity artifactId={artifact.id} /> : null}
						settings={
							isOwner ? (
								<>
									<DefaultPinRow
										artifact={artifact}
										pending={mutations.setDefaultPin.isPending}
										onChange={(defaultPin) => mutations.setDefaultPin.mutate({ defaultPin })}
									/>
									{kind === "team" ? (
										<PublishingRow
											artifact={artifact}
											projectPolicy={projectPolicy}
											pending={mutations.setPublishPolicy.isPending}
											onChange={(publishPolicy) => mutations.setPublishPolicy.mutate({ publishPolicy })}
										/>
									) : null}
								</>
							) : null
						}
						footer={
							<>
								<CopyLinkButton url={url} copiedMessage={generalAccessCopied(artifact)} />
								{isOwner ? (
									<button
										type="button"
										className="whitespace-nowrap hover:text-link-hover"
										onClick={() => setLinkOpen(true)}
									>
										Create an expiring link
									</button>
								) : null}
							</>
						}
					>
						{accessPending ? null : (
							<AddPeopleInput canInvite={ceiling !== null} why={noInvite} onOpen={() => setInviting(true)} />
						)}

						<div style={{ ...HEADING, marginTop: 26 }}>Who has access</div>
						<div className="flex flex-col" style={{ gap: 4, marginTop: 10 }}>
							{isOwner && me.data ? (
								<OwnerRow name={me.data.name} email={me.data.email} />
							) : (
								<OwnerRow name={artifact.ownerName} email={null} />
							)}
							{ceiling !== null && grants.isPending ? <p>Loading invited people…</p> : null}
							{ceiling !== null && grants.isError ? (
								<p role="alert">
									Could not load invited people.{" "}
									<button type="button" onClick={() => void grants.refetch()}>
										Retry
									</button>
								</p>
							) : null}
							{viewerNames.map((name, index) => (
								<PersonRow key={`${name}-${index}`} name={name} />
							))}
							{members.map((grant) => (
								<PersonRow key={grant.id} name={grant.granteeName} meta={metaOf(grant)}>
									<GranteeControls
										grant={grant}
										kind={kind}
										canManage={isOwner}
										onRole={(role) => mutations.setRole.mutate({ grantId: grant.id, role })}
										onRemove={() => mutations.remove.mutate({ grantId: grant.id })}
										pin={pinFor(grant)}
									/>
								</PersonRow>
							))}
						</div>
						<InvitedSection
							invited={invited}
							renderControls={(grant) => (
								<GranteeControls
									grant={grant}
									kind={kind}
									canManage={isOwner}
									onRole={(role) => mutations.setRole.mutate({ grantId: grant.id, role })}
									onRemove={() => mutations.remove.mutate({ grantId: grant.id })}
									removeTitle="Cancel invite"
									pin={pinFor(grant)}
									lead={<CopyInviteLink email={grant.granteeEmail} url={url} />}
								/>
							)}
						/>
						{ceiling === null || grants.isSuccess ? (
							<div style={{ fontSize: 14, color: "var(--color-secondary)", marginTop: 14 }}>{note}</div>
						) : null}
						<GeneralAccessSection
							artifact={artifact}
							isOwner={isOwner}
							variant="desktop"
							anyone={anyone}
							mutation={generalAccess}
						/>
					</PeopleStep>
				)}
			</ShareFrame>
			{isOwner && linkOpen ? <LinkDialog artifactId={artifact.id} onClose={() => setLinkOpen(false)} /> : null}
		</>
	)
}

const ProjectSharePanel = ({
	projectId,
	projectName,
	onClose,
}: {
	projectId: string
	projectName: string
	onClose: () => void
}) => {
	// The server says what the caller may do here; nothing renders as Owner or non-Owner until it has.
	const {
		me,
		access,
		ceiling,
		workspace,
		noInvite,
		mutations,
		members,
		invited,
		create,
		fileCount,
		isOwner,
		project,
		setLinkPreview,
		url,
	} = useProjectShareModel(projectId)
	const { kind } = workspace
	const [inviting, setInviting] = useState(false)
	const subtitle = `${projectName} · ${fileCount === 1 ? "1 file" : `${fileCount} files`}`
	const workspaceName = me.data?.workspaceName ?? "your workspace"

	const controlsFor = (grant: Grant, lead?: ReactNode) => (
		<GranteeControls
			grant={grant}
			kind={kind}
			canManage={isOwner}
			onRole={(role) => mutations.setRole.mutate({ grantId: grant.id, role })}
			onRemove={() => mutations.remove.mutate({ grantId: grant.id })}
			removeTitle={lead ? "Cancel invite" : "Remove access"}
			lead={lead}
		/>
	)

	return (
		<ShareFrame onClose={onClose}>
			{inviting ? (
				<InviteView
					subtitle={subtitle}
					target={{ projectId }}
					ceiling={ceiling}
					kind={kind}
					workspaceName={workspaceName}
					revisions={[]}
					create={create}
					onBack={() => setInviting(false)}
				/>
			) : (
				<PeopleStep
					title="Share project"
					subtitle={subtitle}
					onClose={onClose}
					settings={
						isOwner && project && kind === "team" ? (
							<LinkPreviewRow
								value={project.linkPreview}
								pending={setLinkPreview.isPending}
								onChange={(linkPreview) => setLinkPreview.mutate({ projectId, linkPreview })}
							/>
						) : null
					}
					footer={<CopyLinkButton url={url} />}
				>
					{access.isLoading ? null : (
						<>
							<AddPeopleInput canInvite={ceiling !== null} why={noInvite} onOpen={() => setInviting(true)} />

							{ceiling === null ? null : (
								<>
									<div style={{ ...HEADING, marginTop: 26 }}>Who has access</div>
									<div className="flex flex-col" style={{ gap: 4, marginTop: 10 }}>
										{isOwner && me.data ? <OwnerRow name={me.data.name} email={me.data.email} /> : null}
										{members.map((grant) => (
											<PersonRow key={grant.id} name={grant.granteeName} meta={grant.granteeEmail}>
												{controlsFor(grant)}
											</PersonRow>
										))}
									</div>
									<InvitedSection
										invited={invited}
										renderControls={(grant) =>
											controlsFor(grant, <CopyInviteLink email={grant.granteeEmail} url={url} />)
										}
									/>
								</>
							)}
						</>
					)}
				</PeopleStep>
			)}
		</ShareFrame>
	)
}

export const ShareDialog = ({ artifact, onClose }: { artifact: VisibleArtifact; onClose: () => void }) => (
	<ArtifactSharePanel artifact={artifact} onClose={onClose} />
)

/** The Project page shares the Project itself, never one of its files. */
export const ProjectShareDialog = ({
	projectId,
	projectName,
	onClose,
}: {
	projectId: string
	projectName: string
	onClose: () => void
}) => <ProjectSharePanel projectId={projectId} projectName={projectName} onClose={onClose} />
