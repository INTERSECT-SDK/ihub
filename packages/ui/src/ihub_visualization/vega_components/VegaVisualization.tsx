import { VegaVisualizationData } from '@ihub/utils/types/visualization'
import React, { useState, useEffect, ComponentType, useRef } from 'react'
import { UseVegaEmbedParams } from 'react-vega'
import { vegaDefaultOptions } from './VegaDefaultOptions'

const VegaComponent: React.FC<UseVegaEmbedParams> = (props) => {
  const [loading, setLoading] = useState(true)
  const [VegaEmbedComponent, setVegaEmbedComponent] =
    useState<ComponentType<UseVegaEmbedParams> | null>(null)

  useEffect(() => {
    const loadVegaEmbed = async () => {
      const { VegaEmbed } = await import('react-vega')
      setVegaEmbedComponent(
        () => VegaEmbed as ComponentType<UseVegaEmbedParams>,
      )
      setLoading(false)
    }
    loadVegaEmbed()
  }, [])

  if (loading) {
    return <div>Loading vega...</div>
  }

  return VegaEmbedComponent ? <VegaEmbedComponent {...props} /> : null
}

interface VegaVisualizationProps {
  visData: VegaVisualizationData
  options?: any
}

export function VegaVisualization({
  visData,
  options = vegaDefaultOptions,
}: VegaVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const vegaRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 370, height: 250 })
  const lastDimensionsRef = useRef({ width: 370, height: 250 })

  useEffect(() => {
    if (!containerRef.current) return

    let rafId: number | null = null
    let timeoutId: NodeJS.Timeout | null = null

    const updateDimensions = () => {
      if (rafId) {
        cancelAnimationFrame(rafId)
      }

      rafId = requestAnimationFrame(() => {
        if (containerRef.current) {
          const { width, height } = containerRef.current.getBoundingClientRect()

          // Calculate target dimensions with padding
          const targetWidth = Math.floor(width - 20)
          const targetHeight = Math.floor(height - 20)

          // Clamp dimensions to reasonable values
          const clampedWidth = Math.min(Math.max(targetWidth, 340), 2000)
          const clampedHeight = Math.min(Math.max(targetHeight, 200), 2000)

          // Only update if dimensions changed significantly (more than 5px) and are valid
          const widthDiff = Math.abs(
            clampedWidth - lastDimensionsRef.current.width,
          )
          const heightDiff = Math.abs(
            clampedHeight - lastDimensionsRef.current.height,
          )

          if (width > 0 && height > 0 && (widthDiff > 5 || heightDiff > 5)) {
            lastDimensionsRef.current = {
              width: clampedWidth,
              height: clampedHeight,
            }
            setDimensions({ width: clampedWidth, height: clampedHeight })
          }
        }
        rafId = null
      })
    }

    // Initial measurement with a delay to allow layout to settle
    timeoutId = setTimeout(updateDimensions, 100)

    const resizeObserver = new ResizeObserver(() => {
      updateDimensions()
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      if (rafId) cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
    }
  }, [])

  const responsiveSpec = {
    ...visData.spec,
    width: dimensions.width,
    height: dimensions.height,
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: 0 }}
    >
      <VegaComponent spec={responsiveSpec} options={options} ref={vegaRef} />
    </div>
  )
}
