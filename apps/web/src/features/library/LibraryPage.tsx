import { type LibraryScope } from "@exagram/api-client"

import { LibraryScreen } from "@/features/library/LibraryScreen"

export const LibraryPage = ({ scope }: { scope: LibraryScope }) => <LibraryScreen scope={scope} />
