import { oc } from "@orpc/contract"
import { z } from "zod"

import { responseSchema } from "../interface"

import {
	ListNotificationsQuerySchema,
	NotificationListSchema,
	NotificationPreferencesSchema,
	SetNotificationPreferencesBodySchema,
} from "./type"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })

export const notificationsProcedures = {
	/** What is new for the caller since `since`, filtered by their Notification Preferences (ADR 0036, ADR 0040). */
	list: base
		.route({ method: "GET", path: "/" })
		.input(z.object({ query: ListNotificationsQuerySchema }))
		.output(responseSchema(NotificationListSchema)),

	getPreferences: base
		.route({ method: "GET", path: "/preferences" })
		.output(responseSchema(NotificationPreferencesSchema)),

	/** Replaces the whole object; a field a client that predates ADR 0040 leaves out keeps its saved value. */
	setPreferences: base
		.route({ method: "PUT", path: "/preferences" })
		.input(z.object({ body: SetNotificationPreferencesBodySchema }))
		.output(responseSchema(NotificationPreferencesSchema)),
}

export const notificationsContract = oc.prefix("/notifications").router(notificationsProcedures)
