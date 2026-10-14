import { type ReactNode, useState } from "react"

import { Dialog } from "@/components/Dialog"
import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/Button"
import { useRevisions } from "@/features/artifact/hooks/useRevisions"
import { useCreateLink, useLinks, useRevokeLink } from "@/features/links/hooks/useLinks"
import { formatWhen } from "@/utils/format"

const EXPIRY_CHOICES = [
	{ label: "1 hour", hours: 1 },
	{ label: "1 day", hours: 24 },
	{ label: "7 days", hours: 24 * 7 },
	{ label: "30 days", hours: 24 * 30 },
] as const

const expiryFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString()

/** Screen 2 field metrics: 44px control, white, `var(--color-line-soft)` border, 15px type. */
const CONTROL_STYLE = {
	height: 44,
	padding: "0 14px",
	border: "1px solid var(--color-line-soft)",
	background: "#fff",
	fontSize: 15,
	outline: 0,
} as const

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
	<label className="flex flex-col" style={{ gap: 8 }}>
		<span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
		{children}
	</label>
)

export const LinkDialog = ({ artifactId, onClose }: { artifactId: string; onClose: () => void }) => {
	const links = useLinks(artifactId)
	const revisions = useRevisions(artifactId, true)
	const create = useCreateLink(artifactId)
	const revoke = useRevokeLink(artifactId)
	const toast = useToast()

	const approved = (revisions.data ?? []).filter((revision) => revision.status === "approved")
	const [revisionId, setRevisionId] = useState("")
	const [hours, setHours] = useState<number>(24 * 7)
	const [maxViews, setMaxViews] = useState("")
	const [lastUrl, setLastUrl] = useState<string | null>(null)

	const chosenRevision = revisionId || approved[0]?.id || ""

	const copy = (url: string) => {
		void navigator.clipboard.writeText(url).then(
			() => toast("Link copied"),
			() => toast("Could not copy — select the URL and copy it"),
		)
	}

	return (
		<Dialog
			title="Link"
			onClose={onClose}
			helper="A Link serves one pinned Revision to anyone with the URL until it expires or is revoked."
			width={640}
			footer={
				<>
					<Button variant="outline" size={40} onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="primary"
						size={40}
						disabled={chosenRevision === "" || create.isPending}
						onClick={() =>
							create.mutate(
								{
									revisionId: chosenRevision,
									expiresAt: expiryFromNow(hours),
									maxViews: maxViews === "" ? undefined : Number(maxViews),
								},
								{
									onSuccess: (created) => {
										setLastUrl(created.url)
										copy(created.url)
									},
								},
							)
						}
					>
						{create.isPending ? "Creating…" : "Create and copy"}
					</Button>
				</>
			}
		>
			<div className="flex" style={{ gap: 12 }}>
				<Field label="Revision">
					<select
						aria-label="Revision"
						style={CONTROL_STYLE}
						value={chosenRevision}
						onChange={(event) => setRevisionId(event.target.value)}
					>
						{approved.map((revision) => (
							<option key={revision.id} value={revision.id}>
								v{revision.seq}
							</option>
						))}
					</select>
				</Field>
				<Field label="Expires in">
					<select
						aria-label="Expires in"
						style={CONTROL_STYLE}
						value={hours}
						onChange={(event) => setHours(Number(event.target.value))}
					>
						{EXPIRY_CHOICES.map((choice) => (
							<option key={choice.hours} value={choice.hours}>
								{choice.label}
							</option>
						))}
					</select>
				</Field>
				<Field label="Max views">
					<input
						aria-label="Max views"
						style={{ ...CONTROL_STYLE, width: 120 }}
						inputMode="numeric"
						placeholder="no limit"
						value={maxViews}
						onChange={(event) => setMaxViews(event.target.value.replace(/[^0-9]/g, ""))}
					/>
				</Field>
			</div>

			{create.isError ? (
				<p role="alert" style={{ fontSize: 13, color: "var(--color-danger)" }}>
					{create.error.message}
				</p>
			) : null}

			{lastUrl ? (
				<div
					className="flex items-center"
					style={{ gap: 12, padding: "12px 14px", background: "#fff", border: "1px solid var(--color-line-soft)" }}
				>
					<code className="min-w-0 flex-1 truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
						{lastUrl}
					</code>
					<Button variant="outline" size={32} onClick={() => copy(lastUrl)}>
						Copy again
					</Button>
				</div>
			) : null}

			<div>
				<div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Links</div>
				<ul className="flex max-h-[260px] flex-col overflow-y-auto">
					{links.data?.length === 0 ? (
						<li style={{ fontSize: 15, color: "var(--color-muted)", padding: "10px 0" }}>No Links yet.</li>
					) : null}
					{links.data?.map((link) => (
						<li
							key={link.id}
							className="flex items-center"
							style={{ gap: 12, padding: "10px 0", borderBottom: "1px solid var(--color-line)" }}
						>
							<span className="min-w-0 flex-1 truncate" style={{ fontSize: 15, color: "var(--color-secondary)" }}>
								{link.revokedAt ? "revoked" : `expires ${formatWhen(link.expiresAt)}`} ·{" "}
								{link.maxViews === null ? `${link.viewsUsed} views` : `${link.viewsUsed}/${link.maxViews} views`}
							</span>
							{link.revokedAt ? null : (
								<button
									type="button"
									className="hover:bg-chip"
									style={{ fontSize: 14, color: "var(--color-danger)", padding: "6px 10px" }}
									disabled={revoke.isPending}
									onClick={() => revoke.mutate({ linkId: link.id })}
								>
									Revoke
								</button>
							)}
						</li>
					))}
				</ul>
			</div>
		</Dialog>
	)
}
