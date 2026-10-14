import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { useConnections } from "@/features/connections/hooks/useConnections"

export const ConnectionNames = () => {
	const connections = useConnections()
	if (connections.isPending) {
		return (
			<SkeletonStatus label="Loading Connections…">
				<Skeleton width={72} height={12} style={{ marginBlock: 3 }} />
			</SkeletonStatus>
		)
	}
	if (connections.isError) return "Could not load"
	const names = connections.data
		.filter((connection) => connection.revokedAt === null)
		.map((connection) => connection.name)
	return names.length > 0 ? names.join(", ") : "None"
}
