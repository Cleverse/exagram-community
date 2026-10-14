import { IconChevronDown } from "@/components/ui/icons"

type PinOption = { id: string; seq: number; status: string }

const CURRENT = "current"

/**
 * A Pin can only name an approved Revision. Offering a Pending one would publish it, which is the
 * one thing approval exists to prevent. Drawn like the role select beside it: text and a
 * chevron, no box (v3.8).
 */
export const PinMenu = ({
	revisions,
	pinnedRevisionId,
	onChange,
	disabled,
}: {
	revisions: PinOption[]
	pinnedRevisionId: string | null
	onChange: (pinnedRevisionId: string | null) => void
	disabled: boolean
}) => (
	<label className="relative flex flex-none items-center">
		<span className="sr-only">Pin</span>
		<select
			aria-label="Pin"
			className="bg-transparent hover:bg-row-selected"
			style={{
				appearance: "none",
				height: 32,
				padding: "0 26px 0 10px",
				borderRadius: 8,
				border: 0,
				fontSize: 15,
				color: "var(--color-secondary)",
				cursor: "pointer",
				outline: 0,
			}}
			disabled={disabled}
			value={pinnedRevisionId ?? CURRENT}
			onChange={(event) => onChange(event.target.value === CURRENT ? null : event.target.value)}
		>
			<option value={CURRENT}>Latest</option>
			{revisions
				.filter((revision) => revision.status === "approved")
				.map((revision) => (
					<option key={revision.id} value={revision.id}>
						v{revision.seq}
					</option>
				))}
		</select>
		<IconChevronDown
			size={14}
			className="pointer-events-none absolute"
			style={{ right: 8, color: "var(--color-muted)" }}
		/>
	</label>
)
