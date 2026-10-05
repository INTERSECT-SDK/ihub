import { IHubIconCheck, IHubIconPlus, IHubIconX } from '@ihub/utils/icons'
import { Button, Card, Group, Select, Text } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useAtomValue } from 'jotai'
import { useMemo, useState } from 'react'
import { mutate } from 'swr'

import { selectedProjectIdAtom } from '@/atoms/global'

import { FORM_CONTROL_RADIUS, PROJECT_SCOPED_RESOURCE_URLS } from './constants'
import { DynamicField } from './DynamicField'
import {
  buildInitialValues,
  buildSubmitValues,
  getNestedValue,
  isFieldHidden,
  isSecretField,
  setNestedValue,
} from './form-values'
import { useDynamicFieldOptions } from './useDynamicFieldOptions'
import {
  getQuickAddResourceName,
  useQuickAddResources,
} from './useQuickAddResources'
import type { ConnectionFormProps, ConnectionFormValues } from './types'

/**
 * Renders the shared SideNavbar connection form for create and edit flows.
 *
 * The form builds its controls from the provided field definitions, resolves
 * project-scoped option data, and optionally exposes quick-add values copied
 * from resources in other projects.
 *
 * @param props - Configuration for the resource type, field schema, API route,
 * current edit values, and close/success callbacks.
 * @returns A Mantine card containing the dynamic connection form.
 */
export function ConnectionForm({
  mode,
  serverType,
  handleClick,
  fields,
  url,
  formTitle,
  currentValues,
  onSuccess,
}: ConnectionFormProps) {
  const [isError, setIsError] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const selectedProjectId = useAtomValue(selectedProjectIdAtom)
  const initialValues = useMemo(
    () => buildInitialValues(fields, currentValues),
    [currentValues, fields],
  )
  const dynamicOptions = useDynamicFieldOptions(
    fields,
    selectedProjectId || undefined,
  )
  const {
    quickAddEnabled,
    quickAddId,
    quickAddLoading,
    quickAddOptions,
    quickAddResources,
    setQuickAddId,
  } = useQuickAddResources({
    selectedProjectId: selectedProjectId || undefined,
    serverType,
    url,
  })

  const form = useForm<ConnectionFormValues>({
    mode: 'controlled',
    initialValues,
  })

  /**
   * Persists the current form values to the connection endpoint.
   *
   * Create mode submits a `POST` payload and adds `project_id` for project
   * scoped resources. Edit mode submits a `PATCH` payload built with secret
   * field handling so blank secret inputs are not sent as updates.
   *
   * @param submitUrl - API endpoint for the connection resource being saved.
   * @param values - Current controlled form values to serialize into the request.
   */
  async function submitHandler(
    submitUrl: string,
    values: ConnectionFormValues,
  ) {
    setIsLoading(true)
    setIsError(false)
    setErrorMsg('')

    const createBodyValues =
      selectedProjectId && PROJECT_SCOPED_RESOURCE_URLS.has(submitUrl)
        ? { ...values, project_id: selectedProjectId }
        : values
    const payload =
      mode === 'edit'
        ? buildSubmitValues(fields, values, true, serverType)
        : createBodyValues

    const response = await fetch(submitUrl, {
      method: mode === 'edit' ? 'PATCH' : 'POST',
      headers: {
        'Content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    setIsLoading(false)

    if (response.status === 200) {
      mutate(submitUrl)
      if (selectedProjectId && PROJECT_SCOPED_RESOURCE_URLS.has(submitUrl)) {
        mutate(`${submitUrl}?project_id=${selectedProjectId}`)
      }
      if (onSuccess) {
        onSuccess()
      }
      setIsSuccess(true)
      setSuccessMsg(
        mode === 'edit' ? `Updated ${serverType}` : `Added new ${serverType}`,
      )
      handleClick()
    } else {
      setIsError(true)
      setErrorMsg(
        mode === 'edit'
          ? `Error updating ${serverType}`
          : `Error adding ${serverType}`,
      )
    }
  }

  /**
   * Applies or clears a quick-add resource selection.
   *
   * Selecting a resource prefills compatible form fields from another project
   * while preserving any existing secret values from the blank initial state.
   * Clearing the selection restores the form to its original initial values.
   *
   * @param resourceId - Selected quick-add resource id, or `null` when cleared.
   */
  function handleQuickAddChange(resourceId: string | null) {
    setQuickAddId(resourceId)
    if (!resourceId) {
      form.setValues(initialValues)
      return
    }

    const resource = quickAddResources[resourceId]
    if (!resource) {
      return
    }

    const quickAddValues = buildInitialValues(fields, resource)
    fields.forEach((field) => {
      if (isSecretField(field, serverType)) {
        setNestedValue(
          quickAddValues,
          field.name,
          getNestedValue(initialValues, field.name),
        )
      }
    })
    form.setValues(quickAddValues)
    setIsSuccess(true)
    setSuccessMsg(
      `Prefilled from ${getQuickAddResourceName(url, resource)}. Review and click Add to create it in this project.`,
    )
    setIsError(false)
    setErrorMsg('')
  }

  const title =
    formTitle ||
    (mode === 'edit'
      ? `Edit ${serverType} connection`
      : `Add new ${serverType} connection`)

  return (
    <Card
      radius={'md'}
      variant='outline'
      bg={'var(--mantine-color-white)'}
      bd={'solid 1px var(--mantine-color-gray-3)'}
      withBorder
    >
      <Card.Section>
        <Group p={'sm'}>
          <Text
            fw={'bold'}
            className='cursor-default'
            c={'var(--mantine-color-gray-7)'}
          >
            {title}
          </Text>
        </Group>
      </Card.Section>

      <form
        autoComplete='off'
        onSubmit={form.onSubmit((values) => submitHandler(url, values))}
      >
        {mode === 'create' && quickAddEnabled && (
          <>
            <Select
              label='Quick Add from another project'
              placeholder={
                quickAddLoading
                  ? 'Loading available resources...'
                  : quickAddOptions.length > 0
                    ? 'Choose an existing resource to copy into this project'
                    : 'No eligible resources found in other projects'
              }
              data={quickAddOptions}
              searchable
              clearable
              my='sm'
              radius={FORM_CONTROL_RADIUS}
              value={quickAddId}
              disabled={quickAddLoading || quickAddOptions.length === 0}
              onChange={handleQuickAddChange}
            />
            <Text size='xs' c='dimmed' mb='sm'>
              {quickAddOptions.length > 0
                ? 'This prefills the form from another project. Secret fields like passwords, API keys, and tokens are not copied.'
                : 'Create resources in another accessible project first, then they will appear here for quick add.'}
            </Text>
          </>
        )}

        {fields.map((field) => {
          if (isFieldHidden(field, form.values)) {
            return null
          }

          return (
            <DynamicField
              key={field.name}
              field={field}
              fieldOptions={dynamicOptions[field.name] || field.options || []}
              form={form}
              serverType={serverType}
            />
          )
        })}

        {(isError || isSuccess) && (
          <Text size='xs' c={isError ? 'red' : 'green'} mt='xs'>
            {isError ? errorMsg : successMsg}
          </Text>
        )}

        <Group grow mt={'lg'}>
          <Button
            type='button'
            size='xs'
            radius={'xl'}
            leftSection={<IHubIconX size={18} />}
            color='var(--mantine-color-red-6)'
            onClick={handleClick}
            variant='light'
            disabled={isLoading}
          >
            Cancel
          </Button>

          <Button
            size='xs'
            radius={'xl'}
            leftSection={
              mode === 'edit' ? (
                <IHubIconCheck size={18} />
              ) : (
                <IHubIconPlus size={18} />
              )
            }
            variant='light'
            color='var(--mantine-color-gray-8)'
            type='submit'
            loading={isLoading}
          >
            {mode === 'edit' ? 'Update' : 'Add'}
          </Button>
        </Group>
      </form>
    </Card>
  )
}
