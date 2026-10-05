import { useId } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { getSegmentedControlActiveIndex } from './inputSource'
import classes from './InputSourceSegmentedControl.module.css'

export type InputSourceSegmentedControlOption<Value extends string = string> = {
  label: ReactNode
  value: Value
  disabled?: boolean
}

export type InputSourceSegmentedControlProps<Value extends string = string> = {
  value: Value
  options: readonly InputSourceSegmentedControlOption<Value>[]
  onChange: (value: Value) => void
  ariaLabel?: string
}

/**
 * Local segmented radio control for capability input source selection.
 *
 * The indicator is positioned with CSS percentages so it remains aligned inside
 * React Flow zoom transforms without reading viewport geometry.
 */
export function InputSourceSegmentedControl<Value extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: InputSourceSegmentedControlProps<Value>) {
  const groupName = useId()

  if (options.length === 0) {
    return null
  }

  const activeIndex = getSegmentedControlActiveIndex(options, value)
  const style = {
    '--segment-count': options.length,
    '--active-index': activeIndex,
  } as CSSProperties

  return (
    <div
      aria-label={ariaLabel}
      className={classes.root}
      role='radiogroup'
      style={style}
    >
      <span aria-hidden='true' className={classes.indicator} />
      {options.map((option) => (
        <label className={classes.option} key={option.value}>
          <input
            checked={option.value === value}
            className={classes.input}
            disabled={option.disabled}
            name={groupName}
            onChange={() => {
              if (!option.disabled) {
                onChange(option.value)
              }
            }}
            type='radio'
            value={option.value}
          />
          <span className={classes.label}>{option.label}</span>
        </label>
      ))}
    </div>
  )
}
