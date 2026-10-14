import { createContext, useContext } from "react"

/** The sidebar's one width: it stays 240px while the preview pane is open. */
export const SIDEBAR_WIDTH = 240
/** Settings' own column: 250px. */
export const SETTINGS_SIDEBAR_WIDTH = 250
/** The collapsed rail. */
export const RAIL_WIDTH = 56

/** How wide the shell's sidebar is right now: the full sidebar, or the rail once collapsed. */
export const SidebarWidthContext = createContext(SIDEBAR_WIDTH)
export const useSidebarWidth = () => useContext(SidebarWidthContext)
