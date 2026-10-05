import {
  Box,
  MultiSelect,
  Select,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import type { FieldDef } from '@ihub/utils/types/types'

import { FORM_CONTROL_RADIUS } from './constants'
import { getNestedValue, isSecretField, isTextSecretField } from './form-values'
import { ToolsSelector } from './ToolsSelector'
import {
  type ConnectionFormValues,
  type FieldOption,
  type ToolOption,
} from './types'

type DynamicFieldProps = {
  field: FieldDef
  fieldOptions: FieldOption[] | ToolOption[]
  form: {
    values: ConnectionFormValues
    setFieldValue: (path: string, value: unknown) => void
    getInputProps: (path: string) => Record<string, unknown>
  }
  serverType: string
}

/**
 * Renders a SideNavbar connection field from a `FieldDef`.
 *
 * Handles the field-specific behavior that the shared form needs to preserve:
 * mapped switches, large monospace `system_prompt` textareas, grouped
 * `tool_ids` selection, fetched options, and secret-friendly text inputs.
 */
export function DynamicField({
  field,
  fieldOptions,
  form,
  serverType,
}: DynamicFieldProps) {
  const textSecretField = isTextSecretField(field, serverType)
  const secretField = isSecretField(field, serverType)
  const passwordField = field.type === 'password' && !textSecretField

  if (field.type === 'switch') {
    const fieldValue = getNestedValue(form.values, field.name)
    const isChecked = fieldValue === field.checkedValue
    return (
      <Switch
        key={field.name}
        label={field.label}
        my={'sm'}
        checked={isChecked}
        onChange={(event) => {
          const newValue = event.currentTarget.checked
            ? field.checkedValue
            : field.uncheckedValue
          form.setFieldValue(field.name, newValue)
        }}
      />
    )
  }

  if (field.type === 'textarea') {
    const sysPromptField = field.name === 'system_prompt'
    return (
      <Textarea
        key={field.name}
        label={field.label}
        placeholder={field.placeholder}
        required={field.required}
        my={'sm'}
        radius={FORM_CONTROL_RADIUS}
        minRows={sysPromptField ? 15 : 3}
        autosize={sysPromptField}
        styles={
          sysPromptField
            ? {
                input: {
                  fontFamily: 'monospace',
                  fontSize: '0.9rem',
                  wordWrap: 'break-word',
                },
              }
            : undefined
        }
        {...form.getInputProps(field.name)}
      />
    )
  }

  if (field.type === 'multiselect') {
    if (field.name === 'tool_ids') {
      const tools = (fieldOptions as ToolOption[]) || []
      const fieldValue = getNestedValue(form.values, field.name)
      const selectedTools = Array.isArray(fieldValue)
        ? fieldValue.map((value) => String(value))
        : []
      return (
        <Box key={field.name} my='sm'>
          <Text size='sm' fw={500} mb={1}>
            {field.label}
          </Text>
          <ToolsSelector
            tools={tools}
            selectedToolIds={selectedTools}
            onChange={(toolIds) => form.setFieldValue(field.name, toolIds)}
          />
        </Box>
      )
    }

    return (
      <MultiSelect
        key={field.name}
        label={field.label}
        placeholder={field.placeholder}
        required={field.required}
        my={'sm'}
        radius={FORM_CONTROL_RADIUS}
        data={fieldOptions as FieldOption[]}
        searchable
        clearable
        {...form.getInputProps(field.name)}
      />
    )
  }

  if (field.type === 'select') {
    return (
      <Select
        key={field.name}
        label={field.label}
        placeholder={field.placeholder}
        required={field.required}
        my={'sm'}
        radius={FORM_CONTROL_RADIUS}
        data={fieldOptions as FieldOption[]}
        searchable={field.searchable}
        {...form.getInputProps(field.name)}
      />
    )
  }

  return (
    <TextInput
      key={field.name}
      label={field.label}
      placeholder={
        field.type === 'password' ? 'keep unchanged' : field.placeholder
      }
      required={field.required}
      my={'sm'}
      radius={FORM_CONTROL_RADIUS}
      type={passwordField ? 'password' : 'text'}
      {...form.getInputProps(field.name)}
      autoComplete={passwordField ? 'new-password' : 'off'}
      autoCapitalize='off'
      spellCheck={false}
      data-lpignore='true'
      data-1p-ignore='true'
      data-form-type={secretField ? 'other' : undefined}
    />
  )
}
