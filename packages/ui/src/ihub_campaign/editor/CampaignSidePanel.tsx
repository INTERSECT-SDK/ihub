'use client'

import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'

import {
  clampCampaignInspectorWidth,
  resizeCampaignInspectorWithKeyboard,
} from './campaignInspectorState'
import * as classes from './styles.module.css'

type CampaignSidePanelProps = {
  ariaLabel: string
  children: ReactNode
  width: number
  workspaceWidth: number
  onWidthChange: (width: number) => void
}

/** Shared resizable container for Campaign overview and inspector content. */
export function CampaignSidePanel({
  ariaLabel,
  children,
  width,
  workspaceWidth,
  onWidthChange,
}: CampaignSidePanelProps) {
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = width

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      onWidthChange(
        clampCampaignInspectorWidth(
          startWidth + startX - moveEvent.clientX,
          workspaceWidth,
        ),
      )
    }
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  const handleSeparatorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const nextWidth = resizeCampaignInspectorWithKeyboard(
      width,
      event.key,
      workspaceWidth,
    )
    if (nextWidth === width) return
    event.preventDefault()
    onWidthChange(nextWidth)
  }

  return (
    <aside
      className={classes.campaignSidePanel}
      style={{ width }}
      aria-label={ariaLabel}
    >
      <div
        className={classes.campaignSidePanelSeparator}
        role='separator'
        aria-label='Resize campaign side panel'
        aria-orientation='vertical'
        aria-valuemin={Math.min(320, workspaceWidth / 2)}
        aria-valuemax={Math.min(720, workspaceWidth / 2)}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onKeyDown={handleSeparatorKeyDown}
      />
      {children}
    </aside>
  )
}
