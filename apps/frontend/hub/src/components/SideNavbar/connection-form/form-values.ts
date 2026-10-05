import type { FieldDef } from '@ihub/utils/types/types'

import type { ConnectionFormValues, FieldOption, ToolOption } from './types'

/**
 * Writes a value into an object using a dot-delimited path, creating missing
 * intermediate objects as needed.
 *
 * Existing non-object path segments are replaced with objects so callers can
 * safely build form payloads from flat `FieldDef.name` paths.
 */
export function setNestedValue(
  target: ConnectionFormValues,
  path: string,
  value: unknown,
) {
  const keys = path.split('.')
  const lastKey = keys.pop()

  if (!lastKey) {
    return target
  }

  let current = target
  keys.forEach((key) => {
    if (
      current[key] === undefined ||
      current[key] === null ||
      typeof current[key] !== 'object' ||
      Array.isArray(current[key])
    ) {
      current[key] = {}
    }
    current = current[key] as ConnectionFormValues
  })

  current[lastKey] = value
  return target
}

/**
 * Reads a value from an object using the same dot-delimited paths used by
 * connection form field definitions.
 *
 * Returns `undefined` when any segment in the path is missing or not an object.
 */
export function getNestedValue(source: ConnectionFormValues, path: string) {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object'
          ? (value as ConnectionFormValues)[key]
          : undefined,
      source,
    )
}

/**
 * Builds Mantine form initial values from SideNavbar field definitions.
 *
 * Password fields intentionally initialize blank, fetched select IDs are
 * normalized to strings, and nested field names are preserved as nested objects.
 */
export function buildInitialValues(
  fields: FieldDef[],
  currentValues?: ConnectionFormValues,
) {
  return fields.reduce<ConnectionFormValues>((acc, field) => {
    const defaultValue =
      field.defaultValue ?? (field.type === 'multiselect' ? [] : '')
    let nextValue =
      currentValues && field.type !== 'password'
        ? (getNestedValue(currentValues, field.name) ?? defaultValue)
        : defaultValue

    if (
      field.fetchUrl &&
      field.type === 'select' &&
      typeof nextValue === 'number'
    ) {
      nextValue = String(nextValue)
    }

    if (
      field.fetchUrl &&
      field.type === 'multiselect' &&
      Array.isArray(nextValue)
    ) {
      nextValue = nextValue.map((value) => String(value))
    }

    return setNestedValue(acc, field.name, nextValue)
  }, {})
}

/**
 * Builds the JSON request payload for create or edit submissions.
 *
 * Edit callers can set `preserveBlankPasswords` so blank secret fields are
 * omitted instead of clearing an existing stored secret. Switch fields are
 * converted back to their configured checked/unchecked values.
 */
export function buildSubmitValues(
  fields: FieldDef[],
  values: ConnectionFormValues,
  preserveBlankPasswords = false,
  serverType?: string,
) {
  return fields.reduce<ConnectionFormValues>((acc, field) => {
    const value = getNestedValue(values, field.name)

    if (
      preserveBlankPasswords &&
      isSecretField(field, serverType) &&
      (value === '' || value === null || value === undefined)
    ) {
      return acc
    }

    if (field.type === 'switch') {
      const finalValue =
        typeof value === 'boolean'
          ? value
            ? field.checkedValue
            : field.uncheckedValue
          : value === field.checkedValue
            ? field.checkedValue
            : field.uncheckedValue
      return setNestedValue(acc, field.name, finalValue)
    }

    return setNestedValue(acc, field.name, value)
  }, {})
}

/**
 * Detects text fields that carry secret material even when they are not rendered
 * as password inputs.
 */
export function isTextSecretField(field: FieldDef, serverType?: string) {
  const normalizedName = field.name.toLowerCase()

  return (
    normalizedName.includes('api_key') ||
    normalizedName.includes('apikey') ||
    normalizedName.includes('token') ||
    normalizedName.includes('secret') ||
    (serverType === 'INTERSECT' && normalizedName === 'password')
  )
}

/**
 * Detects fields whose values should be treated as secrets for autocomplete,
 * quick-add copying, and blank edit submission behavior.
 */
export function isSecretField(field: FieldDef, serverType?: string) {
  return field.type === 'password' || isTextSecretField(field, serverType)
}

/**
 * Evaluates static or callback-based field visibility using current form values.
 */
export function isFieldHidden(
  field: FieldDef,
  formValues: ConnectionFormValues,
) {
  if (typeof field.hidden === 'function') {
    return field.hidden(formValues)
  }

  return Boolean(field.hidden)
}

/**
 * Converts fetched API resources into Mantine select data.
 *
 * The `tool_ids` field keeps the grouped tool metadata required by
 * `ToolsSelector`; all other fetched fields are normalized to string IDs.
 */
export function mapFetchedFieldOptions(
  field: FieldDef,
  data: unknown,
): FieldOption[] | ToolOption[] {
  if (!Array.isArray(data)) {
    return []
  }

  if (field.name === 'tool_ids') {
    return data.map((item: Record<string, unknown>) => ({
      id: String(item.id),
      mcp_server_id: Number(item.mcp_server_id),
      mcp_server_label:
        typeof item.mcp_server_label === 'string'
          ? item.mcp_server_label
          : undefined,
      tool_name: String(item.tool_name || item.name || item.id),
    }))
  }

  return data.map((item: Record<string, unknown>) => ({
    label: String(item.label || item.name || item.id),
    value: String(item.id),
  }))
}
