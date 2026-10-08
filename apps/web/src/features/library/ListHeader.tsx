import clsx from "clsx"
import { type MouseEvent, type ReactNode } from "react"

import { IconButton } from "@/components/ui/IconButton"
import { IconArrowUp, IconSearch } from "@/components/ui/icons"
import { MonoCol } from "@/components/ui/Mono"
import { type PageHeaderSize } from "@/features/library/pageHeader"
import { type SortKey } from "@/features/library/sort"

/** A header action (T:L1893): the icon alone, with no border, named by its tooltip and `aria-label`. */
export const HeaderAction = ({
	label,
	onClick,
	expanded,
	children,
}: {
	label: string
	onClick: (event: MouseEvent<HTMLButtonElement>) => void
	expanded?: boolean
	children: ReactNode
}) => (
	<IconButton className="text-ink" title={label} aria-label={label} aria-expanded={expanded} onClick={onClick}>
		{children}
	</IconButton>
)

/** The screen's H1: Archivo 700, sized by `pageHeaderSize`. It truncates rather than wraps. */
export const PageTitle = ({
	size,
	className,
	children,
}: {
	size: PageHeaderSize
	className?: string
	children: ReactNode
}) => (
	<h1
		className={clsx("font-display truncate", className)}
		style={{ fontWeight: 700, fontSize: size.fontSize, letterSpacing: size.tracking, lineHeight: 1.15, margin: 0 }}
	>
		{children}
	</h1>
)

/**
 * The list head (T:L1878–1945): its own block above the scrolling rows, so the title, actions, scope
 * links and column row never scroll away. The title row is at least 48px; the library root, a Project
 * page and the Activity screen fill `below`, `tabs`, `actions` and `listRows` differently.
 */
export const ListHeader = ({
	size,
	breadcrumb,
	title,
	itemCount,
	onOpenSearch,
	actions,
	below,
	tabs,
	listRows,
}: {
	/** From `pageHeaderSize`: the window's height and whether the list below has scrolled. */
	size: PageHeaderSize
	breadcrumb?: ReactNode
	title: ReactNode
	/** Shown after a string title, on its baseline; null while the list is still loading. */
	itemCount?: number | null
	/** Opens the search dialog; `undefined` hides the button (the Activity screen has no list to search). */
	onOpenSearch?: () => void
	actions: ReactNode
	/** A row under the title: the Project page's "Project rules" chip. */
	below?: ReactNode
	/** The library root's scope links. */
	tabs?: ReactNode
	/**
	 * The sort row under the head: sort toggle and column heads. The Activity screen has its own table head and
	 * passes none.
	 */
	listRows?: {
		sort: SortKey
		onToggleSort: () => void
		showProjectColumn: boolean
		/** The Owner column, which All and Shared with me carry. */
		showOwnerColumn?: boolean
		/** The Last activity column; the open preview pane hides it along with the row cells. */
		showMetaColumn: boolean
	}
}) => (
	<div className="flex-none" style={{ padding: `${size.paddingTop}px 28px 0` }}>
		<div className="flex items-end" style={{ gap: 4, minHeight: 48 }}>
			<div className="min-w-0 overflow-hidden" style={{ flex: "1 1 auto" }}>
				{breadcrumb}
				{typeof title === "string" ? (
					<div className="flex min-w-0 items-baseline" style={{ gap: 10 }}>
						<PageTitle size={size} className="min-w-0">
							{title}
						</PageTitle>
						{itemCount === undefined ? null : (
							<span
								className="font-mono flex-none whitespace-nowrap text-muted"
								style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}
							>
								{itemCount === null ? "… items" : `${itemCount} ${itemCount === 1 ? "item" : "items"}`}
							</span>
						)}
					</div>
				) : (
					title
				)}
			</div>

			{onOpenSearch ? (
				<HeaderAction label="Search" onClick={onOpenSearch}>
					<IconSearch size={16} />
				</HeaderAction>
			) : null}

			{actions}
		</div>

		{below ? <div style={{ marginTop: 12 }}>{below}</div> : null}

		{tabs ? <div style={{ marginTop: size.tabsGap }}>{tabs}</div> : null}

		{listRows ? (
			<div
				className="flex items-center"
				style={{ gap: 14, marginTop: 12, padding: "0 10px 10px", borderBottom: "1px solid var(--color-pane-line)" }}
			>
				<button
					type="button"
					onClick={listRows.onToggleSort}
					className="flex items-center hover:text-ink"
					style={{ gap: 6, fontSize: 14, fontWeight: 600 }}
				>
					{listRows.sort === "name" ? "Name" : "Updated"}
					<IconArrowUp size={14} strokeWidth={2.2} />
				</button>
				<div className="flex-1" />
				{listRows.showProjectColumn ? <MonoCol style={{ width: 170, flex: "none" }}>Project</MonoCol> : null}
				{listRows.showOwnerColumn ? (
					<MonoCol style={{ width: 56, flex: "none", textAlign: "center" }}>Owner</MonoCol>
				) : null}
				{listRows.showMetaColumn ? (
					<MonoCol style={{ width: 120, flex: "none", textAlign: "right" }}>Last activity</MonoCol>
				) : null}
			</div>
		) : null}
	</div>
)
