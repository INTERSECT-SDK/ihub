import { ActionIcon, Tooltip } from '@mantine/core'

type propsType = {
  Icon: React.ElementType
  hoverInfo: string
  onClick: () => void
  ariaLabel?: string
  pressed?: boolean
  disabled?: boolean
  showTooltipWhenDisabled?: boolean
}

export function TopMenuButton({
  Icon,
  hoverInfo,
  onClick,
  ariaLabel,
  pressed,
  disabled = false,
  showTooltipWhenDisabled = false,
}: propsType) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
      }}
    >
      <Tooltip
        label={hoverInfo}
        disabled={disabled && !showTooltipWhenDisabled}
      >
        <ActionIcon
          size='sm'
          variant='subtle'
          onClick={onClick}
          aria-label={ariaLabel ?? hoverInfo}
          aria-pressed={pressed}
          color={pressed ? 'blue' : undefined}
          data-active={pressed ? 'true' : undefined}
          disabled={disabled}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon stroke={1.5} />
        </ActionIcon>
      </Tooltip>
    </div>
  )
}
