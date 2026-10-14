import { type GeneralAccess, type VisibleArtifact, type WorkspaceKind } from "@exagram/api-client"

import { useToast } from "@/components/Toast"
import { edition } from "@/edition/edition"
import { type Variant } from "@/edition/edition.port"
import { RecipientPreview } from "@/features/artifact/PasswordGate"
import { AnyoneSettingsPopover } from "@/features/grants/AnyoneSettings"
import {
	generalAccessChosen,
	generalAccessDescription,
	generalAccessLabel,
	generalAccessOption,
	needsAllowedDomain,
} from "@/features/grants/general-access/generalAccess"
import { GeneralAccessMenu } from "@/features/grants/general-access/GeneralAccessMenu"
import { type useSetGeneralAccess } from "@/features/grants/general-access/useSetGeneralAccess"
import { Heading, HEADING, Round } from "@/features/grants/shareParts"
import { type AnyoneSettingsModel } from "@/features/grants/useAnyoneSettings"
import { useWorkspaceOf } from "@/features/workspace/useWorkspaceKind"

type Mutation = ReturnType<typeof useSetGeneralAccess>

type SectionProps = {
	artifact: VisibleArtifact
	kind: WorkspaceKind
	isOwner: boolean
	mutation: Mutation
	choose: (generalAccess: GeneralAccess) => void
}

/**
 * The Share dialog's and share sheet's General access block. Only the Owner changes it. The
 * phone's Link settings are a step of the share sheet, so only desktop draws them here.
 */
export const GeneralAccessSection = ({
	artifact,
	isOwner,
	variant,
	anyone,
	mutation,
}: {
	artifact: VisibleArtifact
	isOwner: boolean
	variant: Variant
	anyone: AnyoneSettingsModel | null
	/** The share model's, so it outlives this section when the dialog moves to another step. */
	mutation: Mutation
}) => {
	const toast = useToast()
	const { kind } = useWorkspaceOf(artifact.workspaceId)
	const choose = (generalAccess: GeneralAccess) =>
		mutation.mutate({ generalAccess }, { onSuccess: () => toast(generalAccessChosen(generalAccess, artifact)) })
	const props = { artifact, kind, isOwner, mutation, choose }
	return variant === "desktop" ? <DesktopSection {...props} anyone={anyone} /> : <MobileSection {...props} />
}

/**
 * General access: only people invited, everyone signed in with Google on the Workspace's Allowed Domain, or
 * anyone with the link. Only the Owner changes it; the Workspace choice needs an Allowed Domain.
 */
const DesktopSection = ({
	artifact,
	kind,
	isOwner,
	mutation,
	choose,
	anyone,
}: SectionProps & {
	/** The Owner's Link settings; they show only while the file is open to Anyone with the link. */
	anyone: AnyoneSettingsModel | null
}) => {
	const { Icon } = generalAccessOption(artifact)
	return (
		<section aria-label="General access">
			<div style={{ ...HEADING, marginTop: 26 }}>General access</div>
			<div className="flex items-center" style={{ gap: 14, marginTop: 10 }}>
				<Round size={34}>
					<Icon size={17} />
				</Round>
				<div className="min-w-0 flex-1">
					{isOwner ? (
						<div style={{ marginLeft: -10 }}>
							<GeneralAccessMenu
								artifact={artifact}
								kind={kind}
								disabled={mutation.isPending}
								pendingValue={mutation.isPending ? mutation.variables?.generalAccess : undefined}
								onChange={choose}
							/>
						</div>
					) : (
						<div style={{ fontSize: 15, fontWeight: 600 }}>{generalAccessLabel(artifact)}</div>
					)}
					<div style={{ fontSize: 14, color: "var(--color-secondary)", marginTop: 2, lineHeight: 1.5 }}>
						{isOwner && needsAllowedDomain(kind, artifact, edition.generalAccessOrg)
							? edition.copy.generalAccessOrg.needsDomain(artifact.workspaceName)
							: generalAccessDescription(artifact)}
					</div>
				</div>
				{artifact.generalAccess !== "restricted" ? (
					<div className="flex-none" style={{ fontSize: 15, color: "var(--color-secondary)", padding: "0 10px" }}>
						Viewer
					</div>
				) : null}
				{isOwner && artifact.generalAccess === "anyone" && anyone ? <AnyoneSettingsPopover anyone={anyone} /> : null}
			</div>
			{mutation.isError ? (
				<p role="alert" className="text-danger" style={{ fontSize: 14, marginTop: 8 }}>
					{mutation.error.message}
				</p>
			) : null}
			{anyone?.previewing ? <RecipientPreview artifactId={artifact.id} onExit={anyone.endPreview} /> : null}
		</section>
	)
}

const MobileSection = ({ artifact, kind, isOwner, mutation, choose }: SectionProps) => (
	<>
		<Heading>General access</Heading>
		<div style={{ height: 8 }} />
		{isOwner ? (
			<div style={{ marginLeft: -10 }}>
				<GeneralAccessMenu
					artifact={artifact}
					kind={kind}
					disabled={mutation.isPending}
					pendingValue={mutation.isPending ? mutation.variables?.generalAccess : undefined}
					onChange={choose}
				/>
			</div>
		) : (
			<div style={{ fontSize: 14.5, fontWeight: 600 }}>{generalAccessLabel(artifact)}</div>
		)}
		<p className="text-muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.45 }}>
			{isOwner && needsAllowedDomain(kind, artifact, edition.generalAccessOrg)
				? edition.copy.generalAccessOrg.needsDomain(artifact.workspaceName)
				: generalAccessDescription(artifact)}
		</p>
		{mutation.isError ? (
			<p role="alert" className="text-danger" style={{ fontSize: 13 }}>
				{mutation.error.message}
			</p>
		) : null}
	</>
)
