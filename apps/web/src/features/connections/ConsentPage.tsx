import { useEffect, useState } from "react"
import { useParams } from "react-router"

import { CONSENT_REACH_COPY, CONSENT_WRITE_NOTE, scopeCopy } from "@/features/connections/consentCopy"
import { useApproveConsent, useConsentInfo, useDenyConsent } from "@/features/connections/hooks/useConsent"
import { useWorkspaceKind } from "@/features/workspace/useWorkspaceKind"

/** The client-detail dialog's surface (prototype line 817), reused for the page the OAuth flow lands on. */
const cardClass = "w-full max-w-[560px] bg-ground-raised px-10 pt-9 pb-10 rounded-(--radius-dialog) shadow-dialog"

export const ConsentPage = () => {
	const { uid = "" } = useParams()
	const info = useConsentInfo(uid)
	const approve = useApproveConsent()
	const deny = useDenyConsent()
	const kind = useWorkspaceKind()

	const [name, setName] = useState("")
	const [scopes, setScopes] = useState<string[]>([])

	useEffect(() => {
		if (!info.data) return
		setName((current) => current || info.data.clientName)
		setScopes((current) => (current.length > 0 ? current : info.data.scopes))
	}, [info.data])

	if (info.isPending) return <p className="p-10 text-[16px] text-muted">Loading…</p>
	if (info.isError)
		return (
			<p role="alert" className="p-10 text-[16px] text-muted">
				{info.error.message}
			</p>
		)

	const busy = approve.isPending || deny.isPending

	return (
		<main className="flex min-h-dvh items-center justify-center bg-ground p-6">
			<div className={cardClass}>
				<h1 className="font-display text-[32px] leading-[1.1] font-bold tracking-[-.02em]">
					{info.data.clientName} wants to connect
				</h1>
				<p className="mt-6 text-[17px] leading-[1.5] text-secondary">
					{info.data.hasNamedFolderAccess ? CONSENT_REACH_COPY.named : CONSENT_REACH_COPY.all}
				</p>
				<p className="font-mono mt-4 text-[12px] tracking-[.16em] text-muted uppercase">{info.data.resource}</p>

				<label className="mt-8 block">
					<span className="font-display block text-[20px] font-semibold">Name this connection</span>
					<input
						className="mt-3 h-10 w-full border border-line-strong bg-white px-3 text-[15px] outline-none focus:border-ink focus:shadow-[0_0_0_1px_var(--color-ink)]"
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</label>

				<fieldset className="mt-8" disabled={busy}>
					<legend className="font-display text-[20px] font-semibold">What it may do</legend>
					<div className="mt-3 flex flex-col gap-2.5">
						{info.data.scopes.map((scope) => (
							<label key={scope} className="flex items-center gap-3 text-[17px]">
								<input
									type="checkbox"
									checked={scopes.includes(scope)}
									onChange={() =>
										setScopes(scopes.includes(scope) ? scopes.filter((s) => s !== scope) : [...scopes, scope])
									}
								/>
								{scopeCopy(scope, kind)}
							</label>
						))}
					</div>
				</fieldset>

				{approve.isError ? (
					<p role="alert" className="mt-4 text-[15px] text-danger">
						{approve.error.message}
					</p>
				) : null}

				<div className="mt-8 flex gap-3">
					<button
						type="button"
						className="press bg-primary text-white hover:bg-primary-hover h-11 px-[18px] text-[16px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
						disabled={busy || name.trim() === "" || scopes.length === 0}
						onClick={() => approve.mutate({ uid, name: name.trim(), scopes })}
					>
						{approve.isPending ? "Connecting…" : "Allow"}
					</button>
					<button
						type="button"
						className="h-11 border border-line-strong bg-white px-[18px] text-[15px] hover:bg-menu-hover"
						disabled={busy}
						onClick={() => deny.mutate({ uid })}
					>
						Cancel
					</button>
				</div>
				<p className="mt-4 text-[14px] leading-[1.5] text-muted">{CONSENT_WRITE_NOTE[kind]}</p>
			</div>
		</main>
	)
}
