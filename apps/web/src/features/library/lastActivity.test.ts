import { describe, expect, it } from "vitest"

import { activityWhen, lastActivity } from "./lastActivity"

const now = new Date("2026-09-14T15:00:00")

describe("activityWhen", () => {
	it("names today and yesterday by calendar day, not by 24-hour spans", () => {
		expect(activityWhen(new Date("2026-09-14T00:30:00"), now)).toBe("today")
		expect(activityWhen(new Date("2026-09-13T23:30:00"), now)).toBe("yesterday")
	})

	it("counts days inside a week and falls back to a short date beyond it", () => {
		expect(activityWhen(new Date("2026-09-11T09:12:00"), now)).toBe("3d ago")
		expect(activityWhen(new Date("2026-09-08T09:12:00"), now)).toBe("6d ago")
		expect(activityWhen(new Date("2026-09-07T09:12:00"), now)).toBe("Sep 7")
		expect(activityWhen("2026-08-21T18:51:00", now)).toBe("Aug 21")
	})
})

describe("lastActivity", () => {
	it("says Edited for the reader's own file and Updated for anyone else's", () => {
		expect(lastActivity({ updatedAt: new Date("2026-09-14T09:00:00"), ownerId: "u1", meId: "u1", now })).toBe(
			"Edited today",
		)
		expect(lastActivity({ updatedAt: new Date("2026-09-11T09:00:00"), ownerId: "u2", meId: "u1", now })).toBe(
			"Updated 3d ago",
		)
	})

	it("says Updated while the reader is unknown", () => {
		expect(lastActivity({ updatedAt: new Date("2026-09-13T09:00:00"), ownerId: "u1", meId: undefined, now })).toBe(
			"Updated yesterday",
		)
	})
})
