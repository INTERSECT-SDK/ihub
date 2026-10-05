import type { FieldDef } from '@ihub/utils/types/types'
import { useEffect, useState } from 'react'

import { PROJECT_SCOPED_RESOURCE_URLS } from './constants'
import { mapFetchedFieldOptions } from './form-values'
import type { DynamicFieldOptions } from './types'

function getDynamicOptionsUrl(fetchUrl: string, selectedProjectId?: string) {
  if (selectedProjectId && PROJECT_SCOPED_RESOURCE_URLS.has(fetchUrl)) {
    return `${fetchUrl}?project_id=${selectedProjectId}`
  }

  return fetchUrl
}

/**
 * Fetches option lists for field definitions with `fetchUrl`.
 *
 * Project-owned SideNavbar resources keep their project-scoped query parameter
 * when a project is selected; other dynamic fields use their declared URL.
 */
export function useDynamicFieldOptions(
  fields: FieldDef[],
  selectedProjectId?: string,
) {
  const [dynamicOptions, setDynamicOptions] = useState<DynamicFieldOptions>({})

  useEffect(() => {
    const fieldsWithFetch = fields.filter((field) => field.fetchUrl)

    fieldsWithFetch.forEach(async (field) => {
      if (!field.fetchUrl) {
        return
      }

      try {
        const response = await fetch(
          getDynamicOptionsUrl(field.fetchUrl, selectedProjectId),
        )
        const data = await response.json()
        const options = mapFetchedFieldOptions(field, data)

        setDynamicOptions((prev) => ({
          ...prev,
          [field.name]: options,
        }))
      } catch (err) {
        console.error(`Failed to fetch options for ${field.name}:`, err)
      }
    })
  }, [fields, selectedProjectId])

  return dynamicOptions
}
