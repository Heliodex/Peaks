// Lays the history tree out as drawable nodes and edges for the settings graph.
import { pathIds } from "./workspace-history-tree.js"
import type { HistoryNode, HistoryNodes } from "./workspace-history-types.js"

export interface HistoryGraphNode {
	/** The node the live state is at. */
	current: boolean
	id: string
	label: string
	/** An ancestor of the current node (the branch we're on). */
	onPath: boolean
	/** A direct child of the current node, reachable with redo. */
	redoable: boolean
	/** Whether the label fits beside the node without colliding with the next one. */
	showLabel: boolean
	/** Centre position in layout pixels. */
	x: number
	y: number
}

export interface HistoryGraphEdge {
	/** SVG path data for the curved connector. */
	d: string
	from: string
	/** Whether the edge belongs to the current lineage. */
	onPath: boolean
	to: string
}

export interface HistoryGraph {
	edges: HistoryGraphEdge[]
	height: number
	nodes: HistoryGraphNode[]
	width: number
}

interface GridPosition {
	x: number
	y: number
}

/** Diameter of a graph node; shared with the view so label fitting matches what's drawn. */
export const HISTORY_NODE_SIZE = 16
// Spacing of the settings graph, in layout pixels.
const COLUMN_GAP = 64
const ROW_GAP = 48
// Gap and rough per-character width used to decide whether a node's label fits beside it.
const LABEL_GAP = 6
const LABEL_CHAR_WIDTH = 6

/**
 * A cubic Bézier connector between two node centres. Both control points sit at the vertical midpoint, so the curve leaves the parent and enters the child straight down and bends smoothly across, instead of kinking like a straight line.
 */
const edgePath = (x1: number, y1: number, x2: number, y2: number): string => {
	const mid = (y1 + y2) / 2
	return `M ${x1} ${y1} C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`
}

const centreX = (position: GridPosition): number =>
	(position.x + 0.5) * COLUMN_GAP
const centreY = (position: GridPosition): number => (position.y + 0.5) * ROW_GAP

// Children stay in creation order, so the layout depends only on the tree and navigating between branches never moves a node.
const childrenOf = (node: HistoryNode, nodes: HistoryNodes): HistoryNode[] =>
	node.children
		.map(id => nodes[id])
		.filter((child): child is HistoryNode => Boolean(child))

/** Tidy tree: leaves take sequential columns, each parent centres over its children. */
function placeTree(
	root: HistoryNode,
	nodes: HistoryNodes,
): Map<string, GridPosition> {
	const positions = new Map<string, GridPosition>()
	let nextColumn = 0
	const place = (node: HistoryNode, depth: number): number => {
		const children = childrenOf(node, nodes)
		let column: number
		if (children.length === 0) column = nextColumn++
		else {
			const columns = children.map(child => place(child, depth + 1))
			column = (columns[0] + (columns.at(-1) ?? columns[0])) / 2
		}
		positions.set(node.id, { x: column, y: depth })
		return column
	}
	place(root, 0)
	return positions
}

/**
 * Only show a label when it fits before the next node on its row, so labels never collide.
 * The last node on a row has open space to its right, so its label always shows.
 */
function assignLabelVisibility(graphNodes: HistoryGraphNode[]): void {
	const rows = new Map<number, HistoryGraphNode[]>()
	for (const node of graphNodes) {
		const row = rows.get(node.y)
		if (row) row.push(node)
		else rows.set(node.y, [node])
	}
	for (const row of rows.values()) {
		const sorted = row.toSorted((a, b) => a.x - b.x)
		for (const [index, node] of sorted.entries()) {
			const next = sorted[index + 1]
			node.showLabel =
				!next
				|| next.x - node.x - HISTORY_NODE_SIZE - LABEL_GAP
					>= node.label.length * LABEL_CHAR_WIDTH
		}
	}
}

/**
 * The history laid out as a tree of nodes: depth runs down, siblings spread across, and the current lineage's edges are highlighted.
 * Positions are in layout pixels; the settings view pans and zooms over them.
 */
export function historyGraph(
	nodes: HistoryNodes,
	currentId: string,
): HistoryGraph {
	const root = Object.values(nodes).find(node => node.parent === null)
	if (!root) return { edges: [], height: 0, nodes: [], width: 0 }

	const positions = placeTree(root, nodes)
	const onPath = pathIds(nodes, currentId)
	const redoable = new Set(nodes[currentId]?.children)
	const graphNodes: HistoryGraphNode[] = []
	const edges: HistoryGraphEdge[] = []

	const walk = (node: HistoryNode) => {
		const position = positions.get(node.id)
		if (position)
			graphNodes.push({
				current: node.id === currentId,
				id: node.id,
				label: node.label,
				onPath: onPath.has(node.id),
				redoable: redoable.has(node.id),
				showLabel: false,
				x: centreX(position),
				y: centreY(position),
			})

		for (const child of childrenOf(node, nodes)) {
			const from = positions.get(node.id)
			const to = positions.get(child.id)
			if (from && to)
				edges.push({
					d: edgePath(
						centreX(from),
						centreY(from),
						centreX(to),
						centreY(to),
					),
					from: node.id,
					onPath: onPath.has(node.id) && onPath.has(child.id),
					to: child.id,
				})

			walk(child)
		}
	}
	walk(root)

	let maxColumn = 0
	let maxDepth = 0
	for (const position of positions.values()) {
		maxColumn = Math.max(maxColumn, position.x)
		maxDepth = Math.max(maxDepth, position.y)
	}
	assignLabelVisibility(graphNodes)

	return {
		edges,
		height: (maxDepth + 1) * ROW_GAP,
		nodes: graphNodes,
		width: (maxColumn + 1) * COLUMN_GAP,
	}
}
