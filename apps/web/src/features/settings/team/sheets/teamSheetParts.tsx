import { type ReactNode } from "react"

export const FieldLabel = ({ htmlFor, children }: { htmlFor: string; children: ReactNode }) => (
	<label htmlFor={htmlFor} className="text-secondary" style={{ fontSize: 13, fontWeight: 500 }}>
		{children}
	</label>
)

export const FormError = ({ children }: { children: ReactNode }) => (
	<p role="alert" className="m-0 text-danger" style={{ fontSize: 13.5 }}>
		{children}
	</p>
)
