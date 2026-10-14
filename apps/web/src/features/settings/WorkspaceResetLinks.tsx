import { Button } from "@/components/ui/Button"
import { IconButton } from "@/components/ui/IconButton"
import { IconCopy } from "@/components/ui/icons"
import { useResetLinks } from "@/features/settings/hooks/useResetLinks"

const inputClass = "h-9 min-w-0 border border-line-soft bg-white px-3 text-[14px] outline-0 focus:border-ink"

/**
 * General's "Reset a password", for an Admin on an install that allows it: a Member's email makes a
 * reset link, shown and copied once, which the Admin sends themselves. Using it ends that person's sessions.
 */
export const WorkspaceResetLinks = () => {
	const resets = useResetLinks()

	return (
		<div className="overflow-hidden rounded-(--radius) border border-line-faint bg-white">
			<form
				className="flex items-center border-b border-line-pale px-6 last:border-b-0"
				style={{ gap: 10, minHeight: 64 }}
				onSubmit={resets.submit}
			>
				<label htmlFor="reset-email" className="sr-only">
					Member's email
				</label>
				<input
					id="reset-email"
					type="email"
					placeholder="name@example.com"
					className={`${inputClass} flex-1`}
					value={resets.email}
					onChange={(event) => resets.setEmail(event.target.value)}
					required
				/>
				<Button type="submit" size={36} disabled={resets.create.isPending || !resets.email.trim()}>
					Create reset link
				</Button>
			</form>
			{resets.errorMessage ? (
				<p role="alert" className="m-0 border-b border-line-pale px-6 py-3 text-[14px] text-danger last:border-b-0">
					{resets.errorMessage}
				</p>
			) : null}
			{resets.issued ? (
				<div className="px-6 py-3">
					<div className="text-[14px] text-muted">
						{`Reset link for ${resets.issued.email}. Send it yourself; it is shown only now, works once, and expires in 1 hour.`}
					</div>
					<div className="mt-1 flex items-center" style={{ gap: 8 }}>
						<span className="font-mono min-w-0 flex-1 truncate text-secondary" style={{ fontSize: 13 }}>
							{resets.issued.url}
						</span>
						<IconButton
							size={32}
							title="Copy reset link"
							aria-label="Copy reset link"
							onClick={() => resets.issued && resets.copy(resets.issued.url)}
						>
							<IconCopy size={15} />
						</IconButton>
					</div>
				</div>
			) : null}
		</div>
	)
}
