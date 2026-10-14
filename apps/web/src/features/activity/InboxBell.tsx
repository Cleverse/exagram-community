import { useNavigate } from "react-router"

import { HeaderIconButton } from "@/components/mobile/primitives"
import { IconBell } from "@/components/ui/icons"
import { useInboxCount } from "@/features/activity/inboxCount"
import { paths } from "@/routes/paths"

/** The top bar's bell: opens the Activity inbox, with an amber count badge while anything waits. */
export const InboxBell = () => {
	const navigate = useNavigate()
	const count = useInboxCount()
	return (
		<HeaderIconButton
			label={count > 0 ? `Activity, ${count} new` : "Activity"}
			onClick={() => void navigate(paths.activity)}
		>
			<IconBell />
			{count > 0 ? (
				<span
					aria-hidden
					className="absolute grid place-items-center bg-pending font-mono text-white"
					style={{
						top: 6,
						right: 5,
						minWidth: 16,
						height: 16,
						padding: "0 4px",
						borderRadius: 8,
						fontSize: 10,
						fontWeight: 600,
						border: "2px solid white",
						boxSizing: "content-box",
					}}
				>
					{count}
				</span>
			) : null}
		</HeaderIconButton>
	)
}
