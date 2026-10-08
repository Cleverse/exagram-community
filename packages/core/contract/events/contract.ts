import { eventIterator, oc } from "@orpc/contract"
import { z } from "zod"

import { LiveEventSchema } from "./type"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })

export const eventsContract = oc.prefix("/events").router({
	/** The caller's live feed: one stream per tab, every Artifact they reach in their workspace. */
	subscribe: base.route({ method: "GET", path: "/" }).input(z.object({})).output(eventIterator(LiveEventSchema)),
})
