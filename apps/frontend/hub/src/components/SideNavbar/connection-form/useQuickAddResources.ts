import type { Project } from '@ihub/utils/types/project'
import { useEffect, useMemo, useState } from 'react'

import { PROJECT_SCOPED_RESOURCE_URLS } from './constants'
import type { ConnectionFormValues, QuickAddOption } from './types'

/**
 * Returns the user-facing label for a resource shown in the quick-add picker.
 *
 * Agent and LLM resources have endpoint-specific preferred names; other
 * resource types fall back through the common label/name/url/id fields.
 */
export function getQuickAddResourceName(
  url: string,
  resource: ConnectionFormValues,
) {
  if (url === '/api/v1/agents') {
    return resource.name || resource.id
  }

  if (url === '/api/v1/llm') {
    return resource.label || resource.model || resource.url || resource.id
  }

  return resource.label || resource.name || resource.url || resource.id
}

/**
 * Loads resources from other projects that can be copied into the active
 * project by the create form.
 *
 * The hook owns quick-add enabled state, loading state, selected resource ID,
 * picker options, and source resources so `ConnectionForm` can handle the copy
 * without duplicating fetch orchestration.
 */
export function useQuickAddResources({
  selectedProjectId,
  serverType,
  url,
}: {
  selectedProjectId?: string
  serverType: string
  url: string
}) {
  const [quickAddId, setQuickAddId] = useState<string | null>(null)
  const [quickAddLoading, setQuickAddLoading] = useState(false)
  const [quickAddOptions, setQuickAddOptions] = useState<QuickAddOption[]>([])
  const [quickAddResources, setQuickAddResources] = useState<
    Record<string, ConnectionFormValues>
  >({})
  const quickAddEnabled = Boolean(
    selectedProjectId && PROJECT_SCOPED_RESOURCE_URLS.has(url),
  )

  useEffect(() => {
    async function loadQuickAddOptions() {
      if (!quickAddEnabled || !selectedProjectId) {
        setQuickAddOptions([])
        setQuickAddResources({})
        setQuickAddId(null)
        setQuickAddLoading(false)
        return
      }

      try {
        setQuickAddLoading(true)
        const [projectsResponse, resourcesResponse] = await Promise.all([
          fetch('/api/v1/projects/'),
          fetch(url),
        ])

        if (!projectsResponse.ok || !resourcesResponse.ok) {
          return
        }

        const projects = (await projectsResponse.json()) as Project[]
        const resources =
          (await resourcesResponse.json()) as ConnectionFormValues[]
        const projectNameById = Object.fromEntries(
          projects.map((project) => [project.id, project.name]),
        )

        const eligibleResources = resources.filter(
          (resource) =>
            resource.project_id && resource.project_id !== selectedProjectId,
        )

        const nextResources = Object.fromEntries(
          eligibleResources.map((resource) => [String(resource.id), resource]),
        )

        const nextOptions = eligibleResources.map((resource) => {
          const projectName =
            projectNameById[String(resource.project_id)] || 'Other Project'
          return {
            value: String(resource.id),
            label: `${getQuickAddResourceName(url, resource)} (${projectName})`,
          }
        })

        setQuickAddResources(nextResources)
        setQuickAddOptions(nextOptions)
      } catch (err) {
        console.error(
          `Failed to fetch quick-add resources for ${serverType}:`,
          err,
        )
      } finally {
        setQuickAddLoading(false)
      }
    }

    loadQuickAddOptions()
  }, [quickAddEnabled, selectedProjectId, serverType, url])

  return useMemo(
    () => ({
      quickAddEnabled,
      quickAddId,
      quickAddLoading,
      quickAddOptions,
      quickAddResources,
      setQuickAddId,
    }),
    [
      quickAddEnabled,
      quickAddId,
      quickAddLoading,
      quickAddOptions,
      quickAddResources,
    ],
  )
}
