import { useEffect, useRef } from "react"
import { useLocation, useNavigate } from "react-router"

import { useToast } from "@/components/Toast"
import { paths } from "@/routes/paths"

/**
 * Connecting Google returns to the library with `?google=linked` or an `?error=google_…`. This toasts what
 * happened once and drops the flag from the address. Both shells run it.
 */
export const useGoogleNotice = () => {
	const location = useLocation()
	const navigate = useNavigate()
	const toast = useToast()
	const lastSearch = useRef<string | null>(null)

	useEffect(() => {
		if (location.pathname !== paths.library) return
		if (lastSearch.current === location.search) return

		const searchParams = new URLSearchParams(location.search)
		const notice =
			searchParams.get("google") === "linked"
				? "Google connected."
				: searchParams.get("error") === "google_already_linked"
					? "That Google account is already connected to an account."
					: searchParams.get("error") === "google_failed"
						? "Could not connect Google. Try again."
						: searchParams.get("error") === "google_rate_limited"
							? "Too many Google sign-in attempts. Wait a minute and try again."
							: null
		if (notice === null) return

		lastSearch.current = location.search
		toast(notice)
		searchParams.delete("google")
		searchParams.delete("error")
		void navigate({ pathname: location.pathname, search: searchParams.toString() }, { replace: true })
	}, [location.pathname, location.search, navigate, toast])
}
