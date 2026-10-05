/** Returns whether a Code node's interactive editor belongs on the canvas. */
export function canvasOwnsCodeNodeEditor(
  inspectedNodeId: string | null,
  nodeId: string,
): boolean {
  return inspectedNodeId !== nodeId
}
