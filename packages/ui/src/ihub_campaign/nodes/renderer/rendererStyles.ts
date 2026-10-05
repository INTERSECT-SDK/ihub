import type { CSSProperties } from 'react'

/** Theme-aware styling for an empty renderer preview. */
export const emptyRendererPreviewStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--mantine-color-body)',
  color: 'var(--mantine-color-dimmed)',
}

/** Sizes renderer text according to its shape while retaining theme contrast. */
export function textPreviewStyle(text: string): CSSProperties {
  const isStructured = text.startsWith('{') || text.startsWith('[')
  const isShortValue = !text.includes('\n') && text.length <= 80

  if (isStructured) {
    return {
      alignItems: 'flex-start',
      color: 'var(--mantine-color-text)',
      fontFamily: 'var(--mantine-font-family-monospace)',
      fontSize: '14px',
      lineHeight: 1.5,
      textAlign: 'left',
    }
  }

  if (isShortValue) {
    return {
      alignItems: 'center',
      color: 'var(--mantine-color-text)',
      fontSize: '28px',
      fontWeight: 600,
      lineHeight: 1.25,
      textAlign: 'center',
    }
  }

  return {
    alignItems: 'flex-start',
    color: 'var(--mantine-color-text)',
    fontSize: '18px',
    lineHeight: 1.55,
    textAlign: 'left',
  }
}
