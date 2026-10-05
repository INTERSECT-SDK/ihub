export type KnownFileType = 'icmp' | 'ipynb' | 'ichat' | 'ivis' | 'txt'

export interface User {
  id: string
  firstName: string
  lastName: string
  email: string
  profilePictureUrl: string
}

/** for files and content from the jupyter server */

export interface ContentFile {
  name: string
  path: string
  type: 'directory' | 'file' | 'notebook'
  format?: 'text' | 'json'
  content?: any
  last_modified: string
  created: string
  writable: boolean
  mimetype?: string
}

export interface ContentResponse {
  name: string
  path: string
  type: 'directory'
  content: ContentFile[]
}

type FieldType =
  | 'text'
  | 'password'
  | 'select'
  | 'textarea'
  | 'multiselect'
  | 'switch'

export interface FieldDef {
  name: string
  label?: string
  type?: FieldType
  hidden?: boolean | ((formValues: Record<string, any>) => boolean)
  placeholder?: string
  required?: boolean
  options?: string[] | { label: string; value: string }[]
  multiSelect?: boolean
  searchable?: boolean
  fetchUrl?: string
  defaultValue?: string | string[]
  checkedValue?: string
  uncheckedValue?: string
}

export interface UserProfile {
  name?: string | null | undefined
  email?: string | null | undefined
  image?: string | null | undefined
  [key: string]: any
}

export type VariableItem = {
  title: string
  type: string
  description?: string
  path: string
  default?: unknown
}
