import { QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router"

import { syncShellAttribute } from "@/components/mobile/shell"
import { ToastProvider } from "@/components/Toast"
import { queryClient } from "@/config/queryClient"
import { installUsercontentLinks } from "@/features/artifact/usercontentLinks"
import { restoreScrollAfterReload } from "@/features/webUpdate/scrollMemory"
import { WebUpdateReloader } from "@/features/webUpdate/WebUpdateReloader"
import { router } from "@/routes/router"

const root = document.getElementById("root")
if (!root) throw new Error("missing #root")

syncShellAttribute()
installUsercontentLinks()
// After an update reload, put the reader back where they were once the page has rendered.
restoreScrollAfterReload()

createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<RouterProvider router={router} />
				<WebUpdateReloader />
			</ToastProvider>
		</QueryClientProvider>
	</StrictMode>,
)
