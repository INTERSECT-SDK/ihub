/** Radius used to keep SideNavbar connection form controls visually consistent. */
export const FORM_CONTROL_RADIUS = 'md'

/**
 * Resource collection URLs whose create and option-loading behavior can be
 * scoped to the currently selected project.
 */
export const PROJECT_SCOPED_RESOURCE_URLS = new Set([
  '/api/v1/agents',
  '/api/v1/brokers',
  '/api/v1/llm',
  '/api/v1/mcp_servers',
])
