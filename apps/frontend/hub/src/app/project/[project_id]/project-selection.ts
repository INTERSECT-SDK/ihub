/**
 * Returns a usable project identifier from a Next.js route parameter.
 *
 * Dynamic project routes should provide exactly one non-empty string. Other
 * shapes are rejected so project-scoped state is never initialized from an
 * ambiguous route.
 */
export function normalizeProjectRouteId(
  routeProjectId: string | string[] | undefined,
): string | undefined {
  if (typeof routeProjectId !== 'string') {
    return undefined
  }

  const projectId = routeProjectId.trim()
  return projectId && projectId !== 'undefined' ? projectId : undefined
}

/**
 * Clears a departing project only when it is still the active selection.
 *
 * This protects a newer project selection from stale effect cleanup during
 * client-side navigation and React Strict Mode remounting.
 */
export function clearDepartingProjectSelection(
  currentProjectId: string | undefined,
  departingProjectId: string,
): string | undefined {
  return currentProjectId === departingProjectId ? undefined : currentProjectId
}
