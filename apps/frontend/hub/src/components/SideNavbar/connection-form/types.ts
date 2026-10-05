import type { FieldDef } from '@ihub/utils/types/types'

/** Create/edit mode for the shared SideNavbar connection form. */
export type ConnectionFormMode = 'create' | 'edit'

/** Nested value object used by Mantine form state and request payload helpers. */
export type ConnectionFormValues = Record<string, unknown>

/** Mantine select-compatible option shape accepted by dynamic fields. */
export type FieldOption = string | { label: string; value: string }

/** Tool option shape returned by the MCP tools endpoint for agent forms. */
export type ToolOption = {
  id: string
  mcp_server_id: number
  mcp_server_label?: string
  tool_name: string
}

/** Dynamic options keyed by `FieldDef.name`. */
export type DynamicFieldOptions = Record<string, FieldOption[] | ToolOption[]>

/** Select option for copying an existing resource from another project. */
export type QuickAddOption = {
  value: string
  label: string
}

/** Props shared by the add and edit SideNavbar connection form wrappers. */
export type ConnectionFormProps = {
  mode: ConnectionFormMode
  serverType: string
  handleClick: () => void
  fields: FieldDef[]
  url: string
  formTitle?: string
  currentValues?: ConnectionFormValues
  onSuccess?: () => void
}
