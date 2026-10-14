import { type CSSProperties, useId } from "react"

import { SectionLabel } from "@/components/ui/Mono"
import {
	CONFIRM_EMAIL_LABEL,
	DELETED_HEADING,
	DELETED_ITEMS,
	STAYS_HEADING,
	staysItems,
} from "@/features/settings/deleteAccountCopy"
import { type DeleteAccountFormState } from "@/features/settings/hooks/useDeleteAccountForm"

const ImpactList = ({ heading, items }: { heading: string; items: readonly string[] }) => (
	<div>
		<SectionLabel as="h3">{heading}</SectionLabel>
		<ul
			className="m-0 flex list-disc flex-col pl-5 text-secondary"
			style={{ gap: 4, marginTop: 6, fontSize: 14.5, lineHeight: 1.5 }}
		>
			{items.map((item) => (
				<li key={item}>{item}</li>
			))}
		</ul>
	</div>
)

/**
 * What deleting takes and leaves, then the email the person types to confirm. The buttons live with the caller (a
 * dialog footer, a drawer panel): a footer button reaches this form through `formId`.
 */
export const DeleteAccountForm = ({
	form,
	formId,
	autoFocus = false,
	inputStyle,
}: {
	form: DeleteAccountFormState
	formId?: string
	autoFocus?: boolean
	inputStyle: CSSProperties
}) => {
	const fieldId = useId()
	const addressId = useId()
	const errorId = useId()

	return (
		<form
			id={formId}
			className="flex flex-col"
			style={{ gap: 16 }}
			onSubmit={(event) => {
				event.preventDefault()
				form.submit()
			}}
		>
			<ImpactList heading={DELETED_HEADING} items={DELETED_ITEMS} />
			<ImpactList heading={STAYS_HEADING} items={staysItems(form.inTeam)} />
			<div className="flex flex-col" style={{ gap: 6 }}>
				<label htmlFor={fieldId} style={{ fontSize: 14, fontWeight: 600 }}>
					{CONFIRM_EMAIL_LABEL}
				</label>
				<span id={addressId} className="font-mono text-secondary break-all" style={{ fontSize: 13 }}>
					{form.email}
				</span>
				<input
					id={fieldId}
					type="text"
					inputMode="email"
					autoComplete="off"
					autoCapitalize="none"
					spellCheck={false}
					autoFocus={autoFocus}
					aria-invalid={form.error !== null}
					aria-describedby={form.error === null ? addressId : `${addressId} ${errorId}`}
					value={form.typed}
					onChange={(event) => form.setTyped(event.target.value)}
					className="w-full border border-line-soft bg-white outline-0 focus:border-ink"
					style={inputStyle}
				/>
			</div>
			{form.error ? (
				<p id={errorId} role="alert" className="m-0 text-danger" style={{ fontSize: 13.5 }}>
					{form.error}
				</p>
			) : null}
		</form>
	)
}
