/**
 * Shared sizing constants and resize decision logic for the Hub side navbar.
 */
export const HUB_SIDE_NAVBAR_COLLAPSED_WIDTH = 60
export const HUB_SIDE_NAVBAR_DEFAULT_OPEN_WIDTH = 450
export const HUB_SIDE_NAVBAR_MIN_OPEN_WIDTH = 280
export const HUB_SIDE_NAVBAR_MAX_OPEN_WIDTH = 720

type SidePanelResizeOptions = {
  minWidth?: number
  maxWidth?: number
}

/**
 * Returns the accepted side-panel width for a drag resize.
 *
 * The attempted width is clamped to the configured open-width bounds.
 */
export function getSidePanelResizeWidth(
  attemptedWidth: number,
  {
    minWidth = HUB_SIDE_NAVBAR_MIN_OPEN_WIDTH,
    maxWidth = HUB_SIDE_NAVBAR_MAX_OPEN_WIDTH,
  }: SidePanelResizeOptions = {},
): number {
  return Math.max(minWidth, Math.min(attemptedWidth, maxWidth))
}
