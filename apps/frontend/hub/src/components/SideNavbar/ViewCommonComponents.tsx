import { Button, Badge, Select, Text, Tooltip } from '@mantine/core'
import { IconPlus, IconSortAZ } from '@tabler/icons-react'
import type { FieldDef } from '@ihub/utils/types/types'

import { ConnectionForm } from './connection-form'
import { FORM_CONTROL_RADIUS } from './connection-form/constants'
import { getStatusBadgeColor } from '../status-badge.ts'

type ServerHeaderProps = {
  label?: string
  url?: string
  status?: string
  statusTooltip?: string
}

/**
 * Displays a server's label, URL, and optional status badge.
 *
 * When provided, `statusTooltip` makes the badge keyboard-focusable and
 * exposes additional status details on hover or focus.
 */
export function ServerHeader({
  label,
  url,
  status,
  statusTooltip,
}: ServerHeaderProps) {
  const statusBadge = status ? (
    <Badge
      size='xs'
      color={getStatusBadgeColor(status)}
      tabIndex={statusTooltip ? 0 : undefined}
    >
      {status.toUpperCase()}
    </Badge>
  ) : null

  return (
    <>
      <div>
        <Text size='sm'>{label}</Text>
        <Text size='xs' c={'dimmed'} fw={400}>
          {url}
        </Text>
        {statusTooltip && statusBadge ? (
          <Tooltip
            label={statusTooltip}
            events={{ hover: true, focus: true, touch: false }}
            multiline
            maw={240}
          >
            {statusBadge}
          </Tooltip>
        ) : (
          statusBadge
        )}
      </div>
    </>
  )
}

type CapabilityHeaderProps = {
  label: string
  shortDescription?: string
}

/**
 * Displays a capability label with an optional supporting description.
 */
export function CapabilityHeader({
  label,
  shortDescription,
}: CapabilityHeaderProps) {
  return (
    <>
      <Text size='sm'>{label}</Text>
      <Text size='xs' c={'dimmed'} fw={400}>
        {shortDescription}
      </Text>
    </>
  )
}

type SortDropdownProps = {
  options: string[] | { label: string; value: string }[]
  setSortBy: (value: string | null) => void
}

/**
 * Renders a compact sort selector and reports the selected option value.
 */
export function SortDropdown({ options, setSortBy }: SortDropdownProps) {
  return (
    <Select
      className='px-3 pt-2 pb-4'
      data={options}
      leftSectionPointerEvents='none'
      leftSection={<IconSortAZ size={18} />}
      size='xs'
      radius={FORM_CONTROL_RADIUS}
      placeholder='Sort agents by'
      onChange={(attr) => setSortBy(attr)}
    />
  )
}

type AddConnectionButtonProps = {
  serverType: string
  fields: FieldDef[]
  handleClick: () => void
  expand: boolean
  url: string
  buttonLabel?: string
  formTitle?: string
  hideWhenCollapsed?: boolean
}

/**
 * Displays the connection form when expanded or an add-connection button when
 * collapsed, unless the collapsed state is configured to remain hidden.
 */
export function AddConnectionButton({
  serverType,
  fields,
  handleClick,
  expand,
  url,
  buttonLabel,
  formTitle,
  hideWhenCollapsed,
}: AddConnectionButtonProps) {
  const finalButtonLabel = buttonLabel || `Add ${serverType} connection`
  const finalFormTitle = formTitle || `Add new ${serverType} connection`

  return (
    <div className='px-3 pt-2'>
      {expand ? (
        <>
          <AddNewConnection
            serverType={serverType}
            fields={fields}
            handleClick={handleClick}
            url={url}
            formTitle={finalFormTitle}
          />
        </>
      ) : hideWhenCollapsed ? null : (
        <>
          <Button
            size='xs'
            radius={'xl'}
            variant='outline'
            leftSection={<IconPlus size={18} />}
            fullWidth
            color='var(--mantine-color-gray-6)'
            onClick={handleClick}
          >
            {finalButtonLabel}
          </Button>
        </>
      )}
    </div>
  )
}

interface AddNewConnectionProps {
  serverType: string
  handleClick: () => void
  fields: FieldDef[]
  url: string
  formTitle?: string
}

/**
 * Renders a connection form configured to create a new server connection.
 */
function AddNewConnection({
  serverType,
  handleClick,
  fields,
  url,
  formTitle,
}: AddNewConnectionProps) {
  return (
    <ConnectionForm
      mode='create'
      serverType={serverType}
      handleClick={handleClick}
      fields={fields}
      url={url}
      formTitle={formTitle}
    />
  )
}

type EditConnectionProps = AddNewConnectionProps & {
  currentValues: Record<string, unknown>
  onSuccess?: () => void
}

/**
 * Renders a connection form preconfigured to edit an existing connection.
 */
export function EditConnection({
  serverType,
  handleClick,
  fields,
  url,
  currentValues,
  formTitle,
  onSuccess,
}: EditConnectionProps) {
  return (
    <ConnectionForm
      mode='edit'
      serverType={serverType}
      handleClick={handleClick}
      fields={fields}
      url={url}
      formTitle={formTitle}
      currentValues={currentValues}
      onSuccess={onSuccess}
    />
  )
}
