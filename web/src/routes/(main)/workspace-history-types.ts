import type { Project } from "#lib/project-storage.js"
import type { TimelineSelection } from "#lib/timeline.js"

export interface WorkspaceSnapshot {
	currentProjectId: string
	/** The open timelapse id, or empty when none is open. */
	openId: string
	projects: Project[]
	selections: TimelineSelection[]
}

export interface HistoryNode {
	children: string[]
	id: string
	label: string
	parent: string | null
	/** Monotonic creation order, used for pruning and stable ordering. */
	seq: number
	snapshot: WorkspaceSnapshot
}

export interface HistoryNodes {
	[_: string]: HistoryNode
}
