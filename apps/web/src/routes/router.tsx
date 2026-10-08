import { createBrowserRouter } from "react-router"

import { NotFound } from "@/components/NotFound"
import { edition } from "@/edition/edition"
import { ActivityScreen } from "@/features/activity/ActivityScreen"
import { ArtifactPage } from "@/features/artifact/ArtifactPage"
import { SignedOutArtifact } from "@/features/artifact/signed-out/SignedOutArtifact"
import { AuthGuard } from "@/features/auth/AuthGuard"
import { JoinPage } from "@/features/auth/JoinPage"
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage"
import { SignInPage } from "@/features/auth/SignInPage"
import { SignUpPage } from "@/features/auth/SignUpPage"
import { ConnectionsPage } from "@/features/connections/ConnectionsPage"
import { ConsentPage } from "@/features/connections/ConsentPage"
import { ContextPage } from "@/features/context/ContextPage"
import { LibraryPage } from "@/features/library/LibraryPage"
import { LiveEventsProvider } from "@/features/live/LiveEventsProvider"
import { macNotifies } from "@/features/notifications/macBridge"
import { MacNotifier } from "@/features/notifications/MacNotifier"
import { ProjectPage } from "@/features/project/ProjectPage"
import { ProjectsPage } from "@/features/project/ProjectsPage"
import { SettingsPage } from "@/features/settings/SettingsPage"
import { WebDeployedListener } from "@/features/webUpdate/WebDeployedListener"
import { AppFrame, ByShell } from "@/routes/byShell"
import {
	LegacyArtifactRedirect,
	LegacyPendingRedirect,
	LegacyPreviewRedirect,
	LegacyProjectRedirect,
	RedirectKeepingSearch,
} from "@/routes/LegacyArtifactRedirect"
import { paths } from "@/routes/paths"

/**
 * Each screen names its phone version as `<area>/<Name>`, meaning `src/features/<area>/<Name>.mobile.tsx`
 * (see `ByShell`). A route whose mobile file does not exist yet keeps its desktop screen on a phone.
 */
export const router = createBrowserRouter([
	{ path: "/signin", element: <ByShell desktop={SignInPage} mobile="auth/SignInPage" /> },
	{ path: "/signup", element: <ByShell desktop={SignUpPage} mobile="auth/SignUpPage" /> },
	{ path: "/join/:token", element: <ByShell desktop={JoinPage} mobile="auth/JoinPage" /> },
	{ path: "/reset/:token", element: <ByShell desktop={ResetPasswordPage} mobile="auth/ResetPasswordPage" /> },
	...edition.publicRoutes,
	{
		path: paths.consent(":uid"),
		element: (
			<AuthGuard>
				<ByShell desktop={ConsentPage} mobile="connections/ConsentPage" />
			</AuthGuard>
		),
	},
	{
		element: (
			// Signed out, a file's own address opens the read-only viewer for a file open to anyone with the link
			// (ADR 0042); every other address goes to sign in.
			<AuthGuard signedOut={<SignedOutArtifact />}>
				{/* One live feed per signed-in tab, for every screen in the frame. */}
				<LiveEventsProvider>
					<WebDeployedListener />
					{/* Inside the Mac app (bridge 2) only: the page asks what is new and the app posts it. */}
					{macNotifies() ? <MacNotifier /> : null}
					<AppFrame />
				</LiveEventsProvider>
			</AuthGuard>
		),
		children: [
			{ path: "/", element: <ByShell desktop={LibraryPage} mobile="library/LibraryScreen" props={{ scope: "all" }} /> },
			{
				path: "/shared",
				element: <ByShell desktop={LibraryPage} mobile="library/LibraryScreen" props={{ scope: "sharedWithMe" }} />,
			},
			{
				path: "/mine",
				element: <ByShell desktop={LibraryPage} mobile="library/LibraryScreen" props={{ scope: "mine" }} />,
			},
			{ path: "/projects", element: <ByShell desktop={ProjectsPage} mobile="project/ProjectsPage" /> },
			{ path: "/projects/:projectId", element: <ByShell desktop={ProjectPage} mobile="project/ProjectPage" /> },
			// An Artifact's own page, and the address a share carries. A list previews a file as `?preview=:id`.
			{ path: "/artifacts/:artifactId", element: <ByShell desktop={ArtifactPage} mobile="artifact/ArtifactPage" /> },
			// A preview's former addresses: `/…/artifacts/:id` under a list (see `legacyPreviewTarget`).
			{ path: "/shared/artifacts/:previewId", element: <LegacyPreviewRedirect /> },
			{ path: "/mine/artifacts/:previewId", element: <LegacyPreviewRedirect /> },
			{ path: "/projects/:projectId/artifacts/:previewId", element: <LegacyPreviewRedirect /> },
			{ path: "/activity/artifacts/:previewId", element: <LegacyPreviewRedirect /> },
			// An Artifact's former addresses redirect to `/artifacts/:id`; see `LegacyArtifactRedirect`.
			{ path: "/shares/:legacyId", element: <LegacyArtifactRedirect /> },
			{ path: "/shares/projects/:legacyProjectId", element: <LegacyProjectRedirect /> },
			{ path: "/artifact/:legacyId", element: <LegacyArtifactRedirect /> },
			// Activity lived at `/pending` before it moved to `/activity`.
			{ path: "/pending", element: <LegacyPendingRedirect /> },
			{ path: "/pending/artifacts/:previewId", element: <LegacyPreviewRedirect /> },
			{ path: "/activity", element: <ByShell desktop={ActivityScreen} mobile="activity/ActivityScreen" /> },
			{ path: "/context", element: <ByShell desktop={ContextPage} mobile="context/ContextPage" /> },
			{ path: "/connections", element: <ByShell desktop={ConnectionsPage} mobile="connections/ConnectionsPage" /> },
			{ path: "/settings", element: <RedirectKeepingSearch to={paths.settings("general")} /> },
			{ path: "/settings/:tab", element: <ByShell desktop={SettingsPage} mobile="settings/SettingsPage" /> },
			// Former addresses: Organization is Security again, Account folded into General, and the old
			// `/security` page is the Security tab. The Audit screen's old `/activity` is Activity now.
			{
				path: "/settings/organization",
				element: <RedirectKeepingSearch to={paths.settings(edition.settingsPages.security ? "security" : "general")} />,
			},
			{ path: "/settings/account", element: <RedirectKeepingSearch to={paths.settings("general")} /> },
			{
				path: "/security",
				element: <RedirectKeepingSearch to={paths.settings(edition.settingsPages.security ? "security" : "general")} />,
			},
			{ path: "*", element: <NotFound /> },
		],
	},
])
