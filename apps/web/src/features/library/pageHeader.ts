/** The list head's title size and spacing (v5 §2), picked by the window's height and the list's scroll. */
export type PageHeaderSize = {
	fontSize: number
	tracking: string
	paddingTop: number
	/** The space between the title row and the scope tabs. */
	tabsGap: number
}

/** A window at least this tall gets the roomy head. */
export const TALL_VIEWPORT = 900

/** The list has scrolled once its `scrollTop` passes this, and the head compacts. */
const SCROLLED_PAST = 24

export const isScrolled = (scrollTop: number): boolean => scrollTop > SCROLLED_PAST

const SIZES = {
	tall: { fontSize: 32, tracking: "-.02em", paddingTop: 32, tabsGap: 24 },
	short: { fontSize: 24, tracking: "-.015em", paddingTop: 24, tabsGap: 16 },
	tallScrolled: { fontSize: 24, tracking: "-.015em", paddingTop: 16, tabsGap: 12 },
	shortScrolled: { fontSize: 22, tracking: "-.015em", paddingTop: 16, tabsGap: 12 },
} as const satisfies Record<string, PageHeaderSize>

export const pageHeaderSize = ({ tall, scrolled }: { tall: boolean; scrolled: boolean }): PageHeaderSize =>
	scrolled ? (tall ? SIZES.tallScrolled : SIZES.shortScrolled) : tall ? SIZES.tall : SIZES.short
