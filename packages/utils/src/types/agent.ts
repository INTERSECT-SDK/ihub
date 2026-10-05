export type Agent = {
  id: string
  name: string
  description: string | null
  owner_id: string | null
  visibility: 'private' | 'shared' | 'public'
  parent_agent_id: string | null
  version: number
  model_id: number | null
  project_id: string | null
  tool_ids: string[]
  system_prompt: string
  graph_type: string
  memory_type: string
  runtime_config: Record<string, any> | null
  created_at: string
  updated_at: string
}
