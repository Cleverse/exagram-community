import clsx from "clsx"
import { type ReactNode, useEffect, useState } from "react"
import { useParams } from "react-router"

import { SectionLabel } from "@/components/mobile/primitives"
import { BrandMark } from "@/components/ui/BrandMark"
import { CONSENT_REACH_COPY, CONSENT_WRITE_NOTE, scopeCopy } from "@/features/connections/consentCopy"
import { useApproveConsent, useConsentInfo, useDenyConsent } from "@/features/connections/hooks/useConsent"
import { useWorkspaceKind } from "@/features/workspace/useWorkspaceKind"

/** The page's frame: the brand bar a person arriving from their AI client recognises, then the content. */
const Frame = ({ children }: { children: ReactNode }) => (
	// Clear of the status bar, which `viewport-fit=cover` lets the page run under; the actions keep the bottom.
	<main className="flex flex-col bg-white" style={{ minHeight: "100dvh", paddingTop: "env(safe-area-inset-top)" }}>
		<div
			className="flex flex-none items-center border-b border-row-line"
			style={{ gap: 10, height: 56, padding: "0 16px" }}
		>
			<BrandMark cell={4} />
			<span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.012em" }}>Exagram</span>
		</div>
		{children}
	</main>
)

/**
 * The OAuth consent page on a phone. The design has no consent screen, so this is the desktop page's content
 * in the web variant's parts: the MCP clients page's 22px title and 14px lede (W:L461–462), the New project
 * field (44px, 16px text so iOS does not zoom on focus; W:L739), the option cards of Settings → Security
 * (W:L514) for the scopes, and Allow / Cancel pinned to the foot where a thumb reaches them. The desktop
 * card's 40px padding inside a 24px margin left 262px of text at 390px wide and a URL that could not wrap.
 */
export default function ConsentPageMobile() {
	const { uid = "" } = useParams()
	const info = useConsentInfo(uid)
	const approve = useApproveConsent()
	const deny = useDenyConsent()
	const kind = useWorkspaceKind()

	const [name, setName] = useState("")
	const [scopes, setScopes] = useState<string[]>([])

	// Same defaults as desktop: the client's own name, and every scope it asked for until the person unticks some.
	useEffect(() => {
		if (!info.data) return
		setName((current) => current || info.data.clientName)
		setScopes((current) => (current.length > 0 ? current : info.data.scopes))
	}, [info.data])

	if (info.isPending)
		return (
			<Frame>
				<p className="m-0 text-muted" style={{ padding: "18px 16px", fontSize: 15 }}>
					Loading…
				</p>
			</Frame>
		)
	if (info.isError)
		return (
			<Frame>
				<p role="alert" className="m-0 text-muted" style={{ padding: "18px 16px", fontSize: 15 }}>
					{info.error.message}
				</p>
			</Frame>
		)

	const busy = approve.isPending || deny.isPending
	const toggle = (scope: string) =>
		setScopes(scopes.includes(scope) ? scopes.filter((s) => s !== scope) : [...scopes, scope])

	return (
		<Frame>
			<div className="flex-1" style={{ padding: "18px 16px 24px" }}>
				<h1
					className="m-0"
					style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.012em", lineHeight: 1.25, textWrap: "pretty" }}
				>
					{info.data.clientName} wants to connect
				</h1>
				<p className="m-0 text-muted" style={{ fontSize: 14, lineHeight: 1.5, marginTop: 6, textWrap: "pretty" }}>
					{info.data.hasNamedFolderAccess ? CONSENT_REACH_COPY.named : CONSENT_REACH_COPY.all}
				</p>
				<p className="m-0 font-mono text-muted-2" style={{ fontSize: 12, marginTop: 10, overflowWrap: "anywhere" }}>
					{info.data.resource}
				</p>

				<label className="flex flex-col" style={{ gap: 6, marginTop: 22 }}>
					<span className="text-secondary" style={{ fontSize: 13, fontWeight: 500 }}>
						Name this connection
					</span>
					<input
						className="w-full border border-line-strong bg-white outline-0 focus:border-ink"
						style={{ height: 44, padding: "0 12px", fontSize: 16 }}
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</label>

				<fieldset className="m-0 min-w-0 border-0 p-0" style={{ marginTop: 22 }} disabled={busy}>
					<legend className="p-0">
						<SectionLabel style={{ padding: 0 }}>What it may do</SectionLabel>
					</legend>
					<div className="flex flex-col" style={{ gap: 8, marginTop: 8 }}>
						{info.data.scopes.map((scope) => {
							const on = scopes.includes(scope)
							return (
								<label
									key={scope}
									className={clsx(
										"flex cursor-pointer items-start border bg-white active:bg-row-hover",
										on ? "border-ink" : "border-line",
									)}
									style={{ gap: 12, padding: 14, borderRadius: 10 }}
								>
									<input
										type="checkbox"
										className="flex-none accent-ink"
										style={{ width: 18, height: 18, margin: "1px 0 0" }}
										checked={on}
										onChange={() => toggle(scope)}
									/>
									<span style={{ fontSize: 15, lineHeight: 1.45 }}>{scopeCopy(scope, kind)}</span>
								</label>
							)
						})}
					</div>
				</fieldset>

				{approve.isError ? (
					<p role="alert" className="m-0 text-danger" style={{ fontSize: 14, marginTop: 14 }}>
						{approve.error.message}
					</p>
				) : null}

				<p className="m-0 text-muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 18 }}>
					{CONSENT_WRITE_NOTE[kind]}
				</p>
			</div>

			<div
				className="sticky bottom-0 flex flex-none border-t border-row-line bg-white"
				style={{ gap: 8, padding: "12px 16px", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
			>
				<button
					type="button"
					className="flex-1 border border-line-strong bg-white text-body active:bg-row-hover"
					style={{ height: 44, fontSize: 15, fontWeight: 500 }}
					disabled={busy}
					onClick={() => deny.mutate({ uid })}
				>
					Cancel
				</button>
				<button
					type="button"
					className="bg-primary text-white active:bg-primary-hover disabled:opacity-50"
					style={{ flex: 2, height: 44, fontSize: 15, fontWeight: 500 }}
					disabled={busy || name.trim() === "" || scopes.length === 0}
					onClick={() => approve.mutate({ uid, name: name.trim(), scopes })}
				>
					{approve.isPending ? "Connecting…" : "Allow"}
				</button>
			</div>
		</Frame>
	)
}
