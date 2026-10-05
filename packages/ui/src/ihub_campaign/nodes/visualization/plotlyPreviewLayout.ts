/** Overrides saved sizing for the node preview without changing its layout. */
export function buildPlotlyPreviewLayout(
  layout: unknown,
  width: number,
  height: number,
) {
  const savedMargin =
    typeof layout === 'object' && layout !== null && 'margin' in layout
      ? layout.margin
      : undefined

  return {
    ...(typeof layout === 'object' && layout !== null ? layout : {}),
    // Plotly's fallback margins consume most of a small node preview.
    margin: {
      l: 40,
      r: 20,
      t: 40,
      b: 40,
      ...(typeof savedMargin === 'object' && savedMargin !== null
        ? savedMargin
        : {}),
    },
    width,
    height,
    autosize: false,
  }
}
