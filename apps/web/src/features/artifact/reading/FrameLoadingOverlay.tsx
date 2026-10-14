import { SkeletonText } from "@/components/ui/Skeleton"

export const FrameLoadingOverlay = () => (
	<div className="absolute inset-0 z-10 bg-white p-5">
		<SkeletonText label="Loading preview…" lines={6} />
	</div>
)
