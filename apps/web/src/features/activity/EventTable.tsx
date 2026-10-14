import { type Project, type VisibleArtifact } from "@exagram/api-client"
import clsx from "clsx"
import { type MouseEvent, useState } from "react"
import { Link, useLocation } from "react-router"

import { IconChevronRight } from "@/components/ui/icons"
import { type DayGroup } from "@/features/activity/activityFeed"
import { locationOf } from "@/features/activity/location"
import { MoveCell } from "@/features/activity/MoveCell"
import { paths, withPreview } from "@/routes/paths"

const HEAD_CELL = { padding: "0 8px 8px" } as const
const CELL = { padding: "12px 8px" } as const
const NARROW_CELL = { padding: "10px 8px" } as const

/**
 * The Activity event table: a sticky column head, then one collapsible group per day. Five
 * columns — Time · File · Who · Project › folder · actor. While the preview pane narrows the list it is two
 * (`40px 1fr`): each row grows to two lines, the file's name, then the Project › folder chip
 * (`MoveCell compact`) and "tag · detail", padded `10px 8px`; wide rows are padded `12px 8px`. Every cell
 * sits at the top on a 19px line, so the time and actor line up with the name's first line when it wraps. A row click opens the file in the pane; the
 * file's name is the row's link for the keyboard.
 */
export const EventTable = ({
	groups,
	artifacts,
	projects,
	meId,
	selectedId,
	onSelect,
	wide,
}: {
	groups: DayGroup[]
	artifacts: VisibleArtifact[]
	projects: Project[]
	meId: string | null
	selectedId: string | null
	onSelect: (artifactId: string) => void
	/** False while the pane is open: Who and the actor square drop out. */
	wide: boolean
}) => {
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
	// A row's link carries the feed's own query (`?scope=team`), so a new tab or a copied link keeps it.
	const { search } = useLocation()
	const cell = wide ? CELL : NARROW_CELL
	const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
	const columns = wide ? 5 : 2

	return (
		<table className="w-full" style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
			<colgroup>
				{/* The plan's `52px 1fr 140px 170px 22px`, plus each cell's 8px side padding; narrow is v3's
				    `40px 1fr`. */}
				<col style={{ width: (wide ? 52 : 40) + 16 }} />
				<col />
				{wide ? <col style={{ width: 140 + 16 }} /> : null}
				{wide ? <col style={{ width: 170 + 16 }} /> : null}
				{wide ? <col style={{ width: 22 + 16 }} /> : null}
			</colgroup>
			<thead className="sticky top-0 bg-panel" style={{ zIndex: 2 }}>
				<tr className="text-muted" style={{ fontSize: 14, boxShadow: "inset 0 -1px 0 var(--color-pane-line)" }}>
					<th scope="col" className="text-left font-normal" style={HEAD_CELL}>
						Time
					</th>
					<th scope="col" className="text-left font-normal" style={HEAD_CELL}>
						File
					</th>
					{wide ? (
						<th scope="col" className="text-left font-normal" style={HEAD_CELL}>
							Who
						</th>
					) : null}
					{wide ? (
						<th scope="col" className="text-left font-normal" style={HEAD_CELL}>
							Folder › subfolder
						</th>
					) : null}
					{wide ? (
						<th scope="col" style={HEAD_CELL}>
							<span className="sr-only">Actor</span>
						</th>
					) : null}
				</tr>
			</thead>
			{groups.map((group) => {
				const closed = collapsed[group.key] === true
				// Files, not events: a file published and then resubmitted is one file to sort. And only the
				// reader's own files, the only ones they can move.
				const needs = new Set(
					group.events.flatMap((event) => {
						const artifact = artifactById.get(event.artifactId)
						return artifact !== undefined &&
							artifact.ownerId === meId &&
							locationOf(artifact.projectId, projects).needsFolder
							? [artifact.id]
							: []
					}),
				).size
				const label = group.date ? `${group.name} · ${group.date}` : group.name
				return (
					<tbody key={group.key} aria-label={label}>
						<tr>
							<th colSpan={columns} scope="rowgroup" className="text-left font-normal" style={{ padding: 0 }}>
								<button
									type="button"
									aria-expanded={!closed}
									onClick={() => setCollapsed((current) => ({ ...current, [group.key]: !closed }))}
									className="flex w-full items-baseline overflow-hidden text-left whitespace-nowrap"
									style={{ gap: 8, padding: "20px 8px 6px" }}
								>
									<IconChevronRight
										size={10}
										strokeWidth={2}
										className="flex-none self-center text-secondary"
										style={{
											transform: `rotate(${closed ? 0 : 90}deg)`,
											transition: "transform var(--duration-row) var(--ease-arrive)",
										}}
									/>
									<span style={{ fontSize: 14, fontWeight: 600 }}>{group.name}</span>
									{group.date ? (
										<span className="text-muted" style={{ fontSize: 14 }}>
											{group.date}
										</span>
									) : null}
									<span className="flex-1" />
									<span className="font-mono text-muted" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
										{group.events.length}
									</span>
									<span className={needs > 0 ? "text-pending-fg" : "text-muted"} style={{ fontSize: 12 }}>
										{needs > 0
											? `${needs} ${needs === 1 ? "needs" : "need"} a folder`
											: group.events.length === 1
												? "event"
												: "events"}
									</span>
								</button>
							</th>
						</tr>
						{closed
							? null
							: group.events.map((event) => {
									const artifact = artifactById.get(event.artifactId)
									const selected = event.artifactId === selectedId
									// A pending submission can name a file the reader cannot open (a Collaborator's new file in
									// someone else's Project): its row shows, but it links nowhere and opens nothing.
									const openable = artifact !== undefined
									const open = (mouse: MouseEvent) => {
										if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return
										mouse.preventDefault()
										onSelect(event.artifactId)
									}
									return (
										<tr
											key={event.key}
											onClick={openable ? () => onSelect(event.artifactId) : undefined}
											data-selected={selected || undefined}
											// The fill sits on the cells, so the row's ends can take v3's 6px radius (a <tr> clips nothing).
											className={clsx(
												"[&>td]:transition-colors [&>td]:duration-(--duration-row) [&>td]:ease-(--ease-arrive)",
												"[&>td:first-child]:rounded-l-(--radius) [&>td:last-child]:rounded-r-(--radius) [&>td]:align-top",
												openable && "cursor-pointer",
												selected ? "[&>td]:bg-row-selected" : "hover:[&>td]:bg-row-hover",
											)}
											// Wide rows are at least 52px; a narrow row grows to fit its two lines.
											style={{ height: wide ? 52 : undefined, lineHeight: "19px" }}
										>
											<td
												className="font-mono text-muted"
												style={{ ...cell, fontSize: 12, fontVariantNumeric: "tabular-nums" }}
											>
												{event.time}
											</td>
											<td style={cell}>
												<div className="flex min-w-0 items-baseline" style={{ gap: 8 }}>
													{openable ? (
														<Link
															to={withPreview(paths.activity, search, event.artifactId)}
															onClick={(mouse) => {
																mouse.stopPropagation()
																open(mouse)
															}}
															className="min-w-0 truncate text-ink hover:text-ink"
															style={{ fontSize: 14, flex: "0 1 auto" }}
														>
															{event.target}
														</Link>
													) : (
														<span className="min-w-0 truncate text-ink" style={{ fontSize: 14, flex: "0 1 auto" }}>
															{event.target}
														</span>
													)}
													{wide ? (
														<span
															className={clsx(
																"font-mono min-w-0 truncate",
																event.pending ? "text-pending-fg" : "text-muted",
															)}
															style={{ fontSize: 12, flex: "0 1 auto", maxWidth: "45%" }}
														>
															{event.pending ? <span aria-hidden>⚠ </span> : null}
															{event.tag}
														</span>
													) : null}
												</div>
												{wide ? (
													<div className="truncate text-muted" style={{ fontSize: 12, marginTop: 2 }}>
														{event.detail}
													</div>
												) : (
													<div className="flex min-w-0 items-center" style={{ gap: 8, marginTop: 4 }}>
														{/* The move menu is its own control; its clicks must not open the row. */}
														<span
															className="flex min-w-0 flex-none"
															style={{ maxWidth: "70%" }}
															onClick={(mouse) => mouse.stopPropagation()}
														>
															{artifact ? (
																<MoveCell artifact={artifact} projects={projects} meId={meId} compact />
															) : (
																<span className="truncate text-muted" style={{ fontSize: 12 }}>
																	Not in your library
																</span>
															)}
														</span>
														<span
															className={clsx(
																"min-w-0 flex-1 truncate",
																event.pending ? "text-pending-fg" : "text-muted",
															)}
															style={{ fontSize: 12 }}
														>
															{event.pending ? <span aria-hidden>⚠ </span> : null}
															{event.tag} · {event.detail}
														</span>
													</div>
												)}
											</td>
											{wide ? (
												<td className="truncate text-muted" style={{ ...CELL, fontSize: 14 }}>
													{event.who}
												</td>
											) : null}
											{/* The move menu is its own control; its clicks must not open the row. */}
											{wide ? (
												<td style={CELL} onClick={(mouse) => mouse.stopPropagation()}>
													{artifact ? (
														<MoveCell artifact={artifact} projects={projects} meId={meId} />
													) : (
														<span className="text-muted" style={{ fontSize: 14 }}>
															Not in your library
														</span>
													)}
												</td>
											) : null}
											{wide ? (
												<td style={CELL}>
													<span
														title={event.who}
														className="font-mono grid place-items-center bg-hover text-muted"
														style={{ width: 22, height: 22, fontSize: 9, fontWeight: 500 }}
													>
														{event.actor}
													</span>
												</td>
											) : null}
										</tr>
									)
								})}
					</tbody>
				)
			})}
		</table>
	)
}
