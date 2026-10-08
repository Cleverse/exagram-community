import type { ReactNode } from "react"

/**
 * The centred column the full-width screens use: `max-width: {1040 | 1120}px; margin: 0 auto;
 * padding: 32px 40px 96px` inside a `min-height: 100vh` wrapper (prototype lines 405–406, 525–526,
 * 661–662, 741–742). MCP and Security are 1040; Context and Audit are 1120.
 */
export const PageContainer = ({
	width,
	label,
	children,
}: {
	width: 1040 | 1120
	/** The prototype's `data-screen-label`; it names the screen for tests and screenshots. */
	label?: string
	children: ReactNode
}) => (
	<div data-screen-label={label} style={{ minHeight: "100vh" }}>
		<div style={{ maxWidth: width, margin: "0 auto", padding: "32px 40px 96px" }}>{children}</div>
	</div>
)
