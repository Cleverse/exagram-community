import { useCallback } from "react"

import { useLocalStore } from "@/mock/store"

/** Tags are the design's, not the API's, so they live beside the artifact id in the mock store. */
export const useTags = (artifactId: string) => {
	const [tags, setTags] = useLocalStore<string[]>(`tags.${artifactId}`, [])

	const add = useCallback(
		(value: string) => {
			const tag = value.trim()
			if (tag === "") return
			setTags((current) => (current.includes(tag) ? current : [...current, tag]))
		},
		[setTags],
	)

	const remove = useCallback((value: string) => setTags((current) => current.filter((tag) => tag !== value)), [setTags])

	return { tags, add, remove }
}
