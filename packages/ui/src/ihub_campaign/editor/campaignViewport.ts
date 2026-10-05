import type { Viewport } from '@xyflow/react'

export const defaultCampaignViewport: Viewport = {
  x: 0,
  y: 0,
  zoom: 0.9,
}

/** Returns the saved camera for a sheet, or a fresh default camera. */
export function getCampaignSheetViewport(
  sheetId: string,
  sheetViewports: Readonly<Record<string, Viewport>> | undefined,
): Viewport {
  return sheetViewports?.[sheetId] ?? { ...defaultCampaignViewport }
}
