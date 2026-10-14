export interface Group {
	id: string
	name: string
	memberCount: number
}

export interface AdminGroup extends Group {
	memberIds: string[]
}

export type GroupList = { view: "admin"; items: AdminGroup[] } | { view: "member"; items: Group[] }

export interface GroupInput {
	name: string
	memberIds: string[]
}
