import { screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { NotFound } from "./NotFound"

import { apiClient } from "@/config/apiClient"
import { clearSentRequests } from "@/features/access-requests/sentRequests"
import { ARTIFACT, renderAsMember } from "@/test/accessRequests"

beforeEach(() => clearSentRequests())
afterEach(() => vi.restoreAllMocks())

describe("NotFound", () => {
	it("shows a refused file as the Request access card without asking the server anything", () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch")
		const create = vi.spyOn(apiClient.accessRequests, "create")
		const feed = vi.spyOn(apiClient.notifications, "list")
		renderAsMember(<NotFound what="file" artifactId={ARTIFACT} />)
		expect(screen.getByRole("heading", { name: "You need access" })).toBeInTheDocument()
		expect(screen.getByText("Ask the owner for access to this file.")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Request access" })).toBeInTheDocument()
		expect(screen.queryByText("404")).not.toBeInTheDocument()
		expect(create).not.toHaveBeenCalled()
		expect(feed).not.toHaveBeenCalled()
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("offers nothing to request on a page that is not a file", () => {
		renderAsMember(<NotFound what="folder" />)
		expect(screen.getByRole("heading", { name: "This folder isn't available" })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Request access" })).not.toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Back to all artifacts" })).toHaveAttribute("href", "/")
	})

	it("is the plain page for an address that names no file", () => {
		renderAsMember(<NotFound />)
		expect(screen.getByRole("heading", { name: "This page isn't available" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: "You need access" })).not.toBeInTheDocument()
	})
})
