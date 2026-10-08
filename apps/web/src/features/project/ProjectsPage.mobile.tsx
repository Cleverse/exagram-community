import { Link } from "react-router"

import { MobileScreen, NewFab } from "@/components/mobile/primitives"
import { FolderGlyph } from "@/components/mobile/rows"
import { useSheet } from "@/components/mobile/sheet/context"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { useMe } from "@/features/auth/hooks/useMe"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { useProjects } from "@/features/library/hooks/useProjects"
import { activityWhen } from "@/features/library/lastActivity"
import { projectsOverview } from "@/features/project/projectsOverview"
import { paths } from "@/routes/paths"

/**
 * The Projects screen on a phone: a root screen (its title comes from `ROOT_TITLES`), one row per top-level
 * Project with the files, who reaches it and its last activity on a second line.
 */
export default function ProjectsPageMobile() {
	const sheet = useSheet()
	const me = useMe()
	const projects = useProjects()
	const everything = useArtifacts({ scope: "all" })
	const rows = projectsOverview(projects.data ?? [], everything.data ?? [], me.data?.id)
	const loading = projects.isPending || everything.isPending || me.isPending

	return (
		<MobileScreen
			label="Projects"
			bodyStyle={{ paddingBottom: 96 }}
			fab={<NewFab onClick={() => sheet.open("new", { projectId: null })} />}
		>
			<div style={{ padding: "8px 6px 0" }}>
				{projects.isError ? (
					<p role="alert" className="text-danger" style={{ padding: "16px 10px", fontSize: 14 }}>
						{projects.error.message}
					</p>
				) : loading ? (
					<SkeletonStatus label="Loading projects…" style={{ padding: "6px 10px" }}>
						{["62%", "48%", "70%"].map((width) => (
							<div key={width} className="flex items-center" style={{ gap: 12, height: 60 }}>
								<Skeleton width={22} height={22} radius={6} />
								<Skeleton width={width} height={12} />
							</div>
						))}
					</SkeletonStatus>
				) : rows.length === 0 ? (
					<div
						className="text-muted"
						style={{ padding: "40px 16px", textAlign: "center", fontSize: 14, textWrap: "pretty" }}
					>
						No projects yet. Create one with New.
					</div>
				) : (
					rows.map((row) => (
						<Link
							key={row.project.id}
							to={paths.project(row.project.id)}
							className="flex w-full items-center text-ink hover:text-ink active:bg-row-hover"
							style={{ gap: 12, minHeight: 60, padding: "8px 10px", borderRadius: 6, textDecoration: "none" }}
						>
							<FolderGlyph />
							<span className="flex min-w-0 flex-1 flex-col" style={{ gap: 2 }}>
								<span className="truncate" style={{ fontSize: 14.5, fontWeight: 450 }}>
									{row.project.name}
								</span>
								<span className="truncate text-muted" style={{ fontSize: 12.5 }}>
									{`${row.files === 1 ? "1 file" : `${row.files} files`} · ${row.access} · ${activityWhen(row.lastActivity)}`}
								</span>
							</span>
						</Link>
					))
				)}
			</div>
		</MobileScreen>
	)
}
