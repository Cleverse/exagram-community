import { type ReactNode } from "react"

import { useToast } from "@/components/Toast"
import { IconCopy, IconPlay } from "@/components/ui/icons"
import { MCP_SERVER_URL } from "@/config/env"

const actionLinkClass = "flex items-center gap-1.5 text-[14px] font-semibold whitespace-nowrap hover:underline"

const Step = ({ n, title, children }: { n: number; title: string; children: ReactNode }) => (
	<li className="flex gap-4">
		<span className="grid size-7 flex-none place-items-center bg-ink text-[13px] font-semibold text-white">{n}</span>
		<div className="min-w-0 flex-1">
			<div className="mt-0.5 text-[17px] font-semibold">{title}</div>
			{children}
		</div>
	</li>
)

export const McpSetupCardView = ({ serverUrl }: { serverUrl: string }) => {
	const toast = useToast()

	const copy = (text: string, done: string) =>
		void navigator.clipboard.writeText(text).then(
			() => toast(done),
			() => toast("Could not copy — select the text and copy it"),
		)

	const command = `claude mcp add --transport http exagram ${serverUrl}`

	return (
		<div id="mcp-connect" className="mt-5 border border-card-line bg-white px-[30px] py-[28px]">
			<div className="flex flex-wrap items-baseline gap-4">
				<div className="font-display text-[22px] font-semibold tracking-[-.01em]">Connect an AI tool</div>
				<div className="flex-1" />
				<button
					type="button"
					className={`${actionLinkClass} text-link hover:text-link-hover`}
					onClick={() => toast("Connector docs are not published yet.")}
				>
					<IconPlay />
					Learn more
				</button>
			</div>
			<p className="mt-1.5 mb-0 max-w-[680px] text-[16px] leading-[1.6] text-pretty text-secondary">
				Open your AI tool, add Exagram, then sign in when prompted. Everything that arrives is private — you invite
				people afterwards, from the Artifact.
			</p>

			<ol className="mt-6 flex list-none flex-col gap-7 p-0">
				<Step n={1} title="Add this endpoint to your AI client">
					<div className="mt-3 flex items-center gap-3 bg-ink py-3 pr-3 pl-5">
						<code className="font-mono min-w-0 flex-1 overflow-x-auto text-[14px] whitespace-nowrap text-ground">
							{command}
						</code>
						<button
							type="button"
							className="flex-none bg-secondary-2 px-3 py-1.5 text-[13px] font-semibold text-ground hover:bg-secondary"
							onClick={() => copy(command, "Command copied.")}
						>
							Copy
						</button>
					</div>
					<p className="mt-2 mb-0 text-[14px] leading-[1.55] text-muted">
						In claude.ai, Claude Desktop, ChatGPT, Cursor or VS Code, add it as a custom connector with this MCP server
						URL: <code className="font-mono bg-menu-hover px-1.5 py-0.5 text-[13px] text-body">{serverUrl}</code>{" "}
						<button
							type="button"
							className="inline-flex items-center gap-1 align-middle font-semibold text-gold-fg hover:underline"
							onClick={() => copy(serverUrl, "Server URL copied.")}
						>
							<IconCopy />
							Copy
						</button>
					</p>
				</Step>
				<Step n={2} title="Sign in when the client asks, then try it">
					<div className="mt-3 border border-row-line bg-white">
						<div className="px-5 py-4 text-[16px] text-body">“Put this conversation in Exagram as pricing model”</div>
						<div className="border-t border-line-pale px-5 py-3 text-[14px] text-muted">
							Takes .md, .html, .txt, code and a whole conversation thread — up to 20 MB per file
						</div>
					</div>
				</Step>
			</ol>

			<div className="mt-6 flex gap-[14px] border border-line-faint bg-line-pale px-[22px] py-5 text-[16px] leading-[1.55] text-body">
				<span className="mt-2 size-[9px] flex-none bg-gold-fg" />
				This connection is yours alone. Artifacts uploaded through it are owned by you, and nobody else sees them until
				you invite them. Once connected it appears in the list above, reaching everything you can; limit it by Scope or
				revoke it there.
			</div>
		</div>
	)
}

export const McpSetupCard = () => <McpSetupCardView serverUrl={MCP_SERVER_URL} />
