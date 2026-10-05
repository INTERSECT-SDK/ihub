export type ProjectVisibility = 'private' | 'shared' | 'public'

export type AccessLevel = 'view' | 'edit'

export type Project = {
  id: string
  name: string
  description: string | null
  visibility: ProjectVisibility
  owner_id: string
  owner_email?: string | null
  current_user_access_level: AccessLevel
  created_at: string
  updated_at: string
}

export type ProjectPermission = {
  id: string
  project_id: string
  user_id: string
  access_level: AccessLevel
  created_at: string
}

export type ProjectCreate = {
  name: string
  description?: string
  visibility?: ProjectVisibility
}

export type ProjectUpdate = {
  name?: string
  description?: string
  visibility?: ProjectVisibility
}

export type ProjectPermissionGrantRequest = {
  user_email: string
  access_level: AccessLevel
}
