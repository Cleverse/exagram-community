import { useNavigate, Link } from "react-router"

import { Button } from "@/components/ui/Button"
import { IconPlus } from "@/components/ui/icons"
import { PageContainer } from "@/components/ui/PageContainer"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { TypeIcon } from "@/components/ui/TypeIcon"
import { useMe } from "@/features/auth/hooks/useMe"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { useProjects } from "@/features/library/hooks/useProjects"
import { activityWhen } from "@/features/library/lastActivity"
import { useLibraryActions } from "@/features/library/useLibraryActions"
import { projectsOverview } from "@/features/project/projectsOverview"
import { paths } from "@/routes/paths"

const CELL = { padding: "12px 8px" } as const

/**
 * Every top-level Project the reader reaches, one row each: Project · Files · Access · Last activity. The
 * sidebar's FOLDERS and SHARED FOLDERS labels open it, and a top-level Project's breadcrumb goes back to it.
 */
export const ProjectsPage = () => {
	const navigate = useNavigate()
	const actions = useLibraryActions()
	const me = useMe()
	const projects = useProjects()
	// Counts are the whole readable library, as in the sidebar.
	const everything = useArtifacts({ scope: "all" })
	const rows = projectsOverview(projects.data ?? [], everything.data ?? [], me.data?.id)
	// Counts, access and dates all need the library and who is reading; rows wait for both rather than jump.
	const loading = projects.isPending || everything.isPending || me.isPending

	return (
		<PageContainer width={1040} label="Folders">
			<div className="flex items-center" style={{ gap: 16 }}>
				<h1 className="font-display m-0 flex-1" style={{ fontWeight: 700, fontSize: 32, letterSpacing: "-.02em" }}>
					Folders
				</h1>
				<Button variant="outline" size={36} onClick={() => actions.newProject()}>
					<IconPlus size={14} strokeWidth={2.2} />
					New folder
				</Button>
			</div>

			{projects.isError ? (
				<p role="alert" className="text-danger mt-9 text-sm">
					{projects.error.message}
				</p>
			) : loading ? (
				<SkeletonStatus label="Loading folders…" className="flex flex-col" style={{ marginTop: 28, gap: 18 }}>
					{["42%", "30%", "36%"].map((width) => (
						<div key={width} className="flex items-center" style={{ gap: 12 }}>
							<Skeleton width={24} height={24} radius={6} />
							<Skeleton width={width} height={12} />
						</div>
					))}
				</SkeletonStatus>
			) : rows.length === 0 ? (
				<p className="text-muted" style={{ marginTop: 28, fontSize: 14, textWrap: "pretty" }}>
					No folders yet. Create one to group related files.
				</p>
			) : (
				<table className="w-full" style={{ marginTop: 24, borderCollapse: "collapse", tableLayout: "fixed" }}>
					<colgroup>
						<col />
						<col style={{ width: 96 }} />
						<col style={{ width: 240 }} />
						<col style={{ width: 140 }} />
					</colgroup>
					<thead>
						<tr className="text-muted" style={{ fontSize: 13, boxShadow: "inset 0 -1px 0 var(--color-pane-line)" }}>
							<th scope="col" className="text-left font-normal" style={{ ...CELL, paddingBottom: 8 }}>
								Folder
							</th>
							<th scope="col" className="text-right font-normal" style={{ ...CELL, paddingBottom: 8 }}>
								Files
							</th>
							<th scope="col" className="text-left font-normal" style={{ ...CELL, paddingBottom: 8 }}>
								Access
							</th>
							<th scope="col" className="text-left font-normal" style={{ ...CELL, paddingBottom: 8 }}>
								Last activity
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr
								key={row.project.id}
								onClick={(event) => {
									// A modified or middle click is the browser's; it reaches the name link instead.
									if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
									void navigate(paths.project(row.project.id))
								}}
								className="cursor-pointer hover:bg-row-hover"
								style={{ boxShadow: "inset 0 -1px 0 var(--color-row-line)", fontSize: 14 }}
							>
								<td style={CELL}>
									<span className="flex min-w-0 items-center" style={{ gap: 12 }}>
										<TypeIcon kind="folder" size={24} />
										{/* The row's keyboard entry point; the row stays clickable for the mouse. */}
										<Link
											to={paths.project(row.project.id)}
											className="min-w-0 truncate text-ink hover:text-ink"
											style={{ fontWeight: 450 }}
											onClick={(event) => event.stopPropagation()}
										>
											{row.project.name}
										</Link>
									</span>
								</td>
								<td className="font-mono text-right text-muted" style={{ ...CELL, fontSize: 13 }}>
									{row.files}
								</td>
								<td className="truncate text-body" style={CELL}>
									{row.access}
								</td>
								<td className="text-muted" style={CELL}>
									{activityWhen(row.lastActivity)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</PageContainer>
	)
}
