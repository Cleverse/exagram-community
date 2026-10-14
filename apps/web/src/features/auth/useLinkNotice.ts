import { useEffect, useRef } from "react"
import { useLocation, useNavigate } from "react-router"

import { useToast } from "@/components/Toast"
import { paths } from "@/routes/paths"

const LINKED: Record<string, string> = {
	google: "Google connected.",
	apple: "Apple connected.",
}

const FAILED: Record<string, string> = {
	google_already_linked: "That Google account is already connected to an account.",
	google_failed: "Could not connect Google. Try again.",
	google_rate_limited: "Too many Google sign-in attempts. Wait a minute and try again.",
	apple_already_linked: "That Apple ID is already connected to an account.",
	apple_failed: "Could not connect Apple. Try again.",
	apple_denied: "Connecting Apple was cancelled.",
	apple_no_email: "Apple did not share an email address, so it could not be connected. Try again and share one.",
	apple_rate_limited: "Too many Apple sign-in attempts. Wait a minute and try again.",
}

/**
 * Connecting Google or Apple returns to the library with `?google=linked`, `?apple=linked` or an `?error=…`. This
 * toasts what happened once and drops the flag from the address. Both shells run it.
 */
export const useLinkNotice = () => {
	const location = useLocation()
	const navigate = useNavigate()
	const toast = useToast()
	const lastSearch = useRef<string | null>(null)

	useEffect(() => {
		if (location.pathname !== paths.library) return
		if (lastSearch.current === location.search) return

		const searchParams = new URLSearchParams(location.search)
		const linked = Object.keys(LINKED).find((provider) => searchParams.get(provider) === "linked")
		const notice = linked !== undefined ? LINKED[linked] : FAILED[searchParams.get("error") ?? ""]
		if (notice === undefined) return

		lastSearch.current = location.search
		toast(notice)
		for (const provider of Object.keys(LINKED)) searchParams.delete(provider)
		searchParams.delete("error")
		void navigate({ pathname: location.pathname, search: searchParams.toString() }, { replace: true })
	}, [location.pathname, location.search, navigate, toast])
}
