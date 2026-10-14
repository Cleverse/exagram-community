export const SettingSelect = <T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string
	value: T
	options: readonly { value: T; label: string }[]
	onChange: (next: T) => void
}) => (
	<select
		aria-label={label}
		className="flex-none rounded-(--radius) border border-line-strong bg-white text-[15px] outline-0 focus:border-ink"
		style={{ height: 40, padding: "0 12px" }}
		value={value}
		onChange={(event) => onChange(event.target.value as T)}
	>
		{options.map((option) => (
			<option key={option.value} value={option.value}>
				{option.label}
			</option>
		))}
	</select>
)
