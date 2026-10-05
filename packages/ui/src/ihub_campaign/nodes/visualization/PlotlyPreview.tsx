import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
} from 'react'
import { buildPlotlyPreviewLayout } from './plotlyPreviewLayout'

type PlotlyComponentProps = {
  data?: unknown
  layout?: unknown
  style?: CSSProperties
}

/** Lazily loads Plotly and renders only after its container has a size. */
export function PlotlyPreview({
  data,
  layout,
}: {
  data: unknown
  layout: unknown
}) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [PlotComponent, setPlotComponent] =
    useState<ComponentType<PlotlyComponentProps> | null>(null)
  const plotContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let isMounted = true
    import('react-plotly.js')
      .then((module) => {
        if (isMounted) {
          setPlotComponent(
            () =>
              module.default as unknown as ComponentType<PlotlyComponentProps>,
          )
        }
      })
      .catch((error) => console.error('Failed to load Plotly component', error))
    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    const container = plotContainerRef.current
    if (!container) return
    const updateSize = () => {
      // Client dimensions exclude React Flow's canvas zoom transform.
      const width = container.clientWidth
      const height = container.clientHeight
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      )
    }
    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const previewLayout = useMemo(
    () => buildPlotlyPreviewLayout(layout, size.width, size.height),
    [layout, size.width, size.height],
  )

  return (
    <div
      ref={plotContainerRef}
      style={{ flex: 1, width: '100%', minHeight: 0, minWidth: 0 }}
    >
      {size.width > 0 && size.height > 0 && PlotComponent ? (
        <PlotComponent
          data={data}
          layout={previewLayout}
          style={{ width: '100%', height: '100%' }}
        />
      ) : null}
    </div>
  )
}
