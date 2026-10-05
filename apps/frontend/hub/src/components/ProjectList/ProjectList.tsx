'use client'

import { listOfProjectsAtom } from '@/atoms/global'
import { useSession } from '@/app/providers/SessionProvider.tsx'
import {
  formatLocalDate,
  parseApiDateTime,
} from '@ihub/utils/helpers/date-time'
import {
  AccessLevel,
  Project,
  ProjectPermissionGrantRequest,
  ProjectUpdate,
  ProjectVisibility,
} from '@ihub/utils/types/project'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Flex,
  Group,
  Menu,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core'
import { useAtom } from 'jotai'
import Link from 'next/link'
import { useEffect, useState } from 'react'

const VISIBILITY_COLORS: Record<ProjectVisibility, string> = {
  private: 'gray',
  shared: 'blue',
  public: 'green',
}

export default function ListOfProjects() {
  const [listOfProjects, setListOfProjects] = useAtom(listOfProjectsAtom)
  const { session } = useSession()
  const userEmail = session?.user?.email ?? ''
  const [activeUserEmails, setActiveUserEmails] = useState<string[]>([])

  // --- Rename state ---
  const [renameProject, setRenameProject] = useState<Project | null>(null)
  const [renameName, setRenameName] = useState('')

  // --- Delete state ---
  const [deleteProject, setDeleteProject] = useState<Project | null>(null)

  // --- Manage access state ---
  const [accessProject, setAccessProject] = useState<Project | null>(null)
  const [permissions, setPermissions] = useState<
    Array<{
      id: string
      user_id: string
      user_email?: string | null
      access_level: AccessLevel
      created_at: string
      project_id: string
    }>
  >([])
  const [grantEmail, setGrantEmail] = useState('')
  const [grantLevel, setGrantLevel] = useState<AccessLevel>('view')

  useEffect(() => {
    fetchProjects()
    fetchActiveUsers()
  }, [])

  async function fetchProjects() {
    try {
      const res = await fetch('/api/v1/projects/')
      if (!res.ok) return
      const data: Project[] = await res.json()
      setListOfProjects(data)
    } catch (e) {
      console.error('Failed to fetch projects', e)
    }
  }

  async function fetchActiveUsers() {
    try {
      const res = await fetch('/api/v1/projects/active-users')
      if (!res.ok) return
      const data: string[] = await res.json()
      setActiveUserEmails(data)
    } catch (e) {
      console.error('Failed to fetch active users', e)
    }
  }

  function formatOwner(ownerEmail?: string | null): string {
    if (!ownerEmail) return 'Unknown'
    const localPart = ownerEmail.split('@')[0] ?? ownerEmail
    return localPart
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  function formatUpdatedAt(value: string): string {
    const date = parseApiDateTime(value)
    if (!date) return 'Unknown'

    const now = new Date()
    const diffMs = now.getTime() - date.getTime()

    // Handle small clock/timezone skews so newly-created projects render as recent.
    const adjustedDiffMs =
      diffMs < 0 && Math.abs(diffMs) < 24 * 60 * 60 * 1000 ? 0 : diffMs

    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour
    const month = 30 * day

    if (adjustedDiffMs < hour) {
      const minutes = Math.max(1, Math.floor(adjustedDiffMs / minute))
      return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
    }
    if (adjustedDiffMs < day) {
      const hours = Math.floor(adjustedDiffMs / hour)
      return `${hours} hour${hours === 1 ? '' : 's'} ago`
    }
    if (adjustedDiffMs < month) {
      const days = Math.floor(adjustedDiffMs / day)
      return `${days} day${days === 1 ? '' : 's'} ago`
    }

    return formatLocalDate(date) ?? 'Unknown'
  }

  async function handleRename() {
    if (!renameProject || !renameName.trim()) return
    const update: ProjectUpdate = { name: renameName.trim() }
    const res = await fetch(`/api/v1/projects/${renameProject.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    })
    if (res.ok) {
      const updated: Project = await res.json()
      setListOfProjects((prev) =>
        prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : prev,
      )
    }
    setRenameProject(null)
    setRenameName('')
  }

  async function handleVisibilityChange(
    project: Project,
    visibility: ProjectVisibility,
  ) {
    const res = await fetch(`/api/v1/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility }),
    })
    if (res.ok) {
      const updated: Project = await res.json()
      setListOfProjects((prev) =>
        prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : prev,
      )
    }
  }

  async function handleDelete() {
    if (!deleteProject) return
    const res = await fetch(`/api/v1/projects/${deleteProject.id}`, {
      method: 'DELETE',
    })
    if (res.ok || res.status === 204) {
      setListOfProjects((prev) =>
        prev ? prev.filter((p) => p.id !== deleteProject.id) : prev,
      )
    }
    setDeleteProject(null)
  }

  async function openManageAccess(project: Project) {
    setAccessProject(project)
    setGrantEmail('')
    setGrantLevel('view')
    const res = await fetch(`/api/v1/projects/${project.id}/permissions`)
    if (res.ok) {
      setPermissions(await res.json())
    }
  }

  async function handleGrantAccess() {
    if (!accessProject || !grantEmail.trim()) return
    const body: ProjectPermissionGrantRequest = {
      user_email: grantEmail.trim(),
      access_level: grantLevel,
    }
    const res = await fetch(
      `/api/v1/projects/${accessProject.id}/permissions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    if (res.ok) {
      const newPerm = await res.json()
      setPermissions((prev) => [...prev, newPerm])
      setGrantEmail('')
    }
  }

  async function handleRevokeAccess(userId: string) {
    if (!accessProject) return
    await fetch(`/api/v1/projects/${accessProject.id}/permissions/${userId}`, {
      method: 'DELETE',
    })
    setPermissions((prev) => prev.filter((p) => p.user_id !== userId))
  }

  async function handleChangeAccessLevel(userId: string, level: AccessLevel) {
    if (!accessProject) return
    const res = await fetch(
      `/api/v1/projects/${accessProject.id}/permissions/${userId}?access_level=${level}`,
      { method: 'PATCH' },
    )
    if (res.ok) {
      const updated = await res.json()
      setPermissions((prev) =>
        prev.map((p) => (p.user_id === userId ? updated : p)),
      )
    }
  }

  if (listOfProjects === null) {
    return <Text c='dimmed'>Loading projects...</Text>
  }

  if (listOfProjects.length === 0) {
    return (
      <Text c='dimmed' mt='md'>
        No projects yet. Create one to get started.
      </Text>
    )
  }

  return (
    <>
      <Table mt='md' highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Owner</Table.Th>
            <Table.Th>Visibility</Table.Th>
            <Table.Th>Last Updated</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {listOfProjects.map((project) => {
            const isOwner =
              (project.owner_email ?? '').toLowerCase() ===
              userEmail.toLowerCase()
            return (
              <Table.Tr key={project.id}>
                <Table.Td>
                  <Link
                    href={`/project/${project.id}`}
                    style={{ textDecoration: 'none' }}
                  >
                    <Text fw={500} c='blue'>
                      {project.name}
                    </Text>
                  </Link>
                </Table.Td>
                <Table.Td>
                  <Text size='sm'>{formatOwner(project.owner_email)}</Text>
                  {project.owner_email && (
                    <Text size='xs' c='dimmed'>
                      {project.owner_email}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge
                    color={VISIBILITY_COLORS[project.visibility]}
                    variant='light'
                  >
                    {project.visibility}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size='sm' c='dimmed'>
                    {formatUpdatedAt(project.updated_at)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {isOwner && (
                    <Menu shadow='md' position='bottom-end'>
                      <Menu.Target>
                        <ActionIcon variant='subtle' color='gray'>
                          ···
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          onClick={() => {
                            setRenameProject(project)
                            setRenameName(project.name)
                          }}
                        >
                          Rename
                        </Menu.Item>
                        <Menu.Item onClick={() => openManageAccess(project)}>
                          Share
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item
                          color='red'
                          onClick={() => setDeleteProject(project)}
                        >
                          Delete
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>

      {/* Rename Modal */}
      <Modal
        opened={!!renameProject}
        onClose={() => setRenameProject(null)}
        title='Rename Project'
      >
        <Stack>
          <TextInput
            label='Project Name'
            value={renameName}
            onChange={(e) => setRenameName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setRenameProject(null)}>
              Cancel
            </Button>
            <Button onClick={handleRename}>Save</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        opened={!!deleteProject}
        onClose={() => setDeleteProject(null)}
        title='Delete Project'
      >
        <Stack>
          <Text>
            Are you sure you want to delete{' '}
            <Text component='span' fw={700}>
              {deleteProject?.name}
            </Text>
            ? This action cannot be undone.
          </Text>
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setDeleteProject(null)}>
              Cancel
            </Button>
            <Button color='red' onClick={handleDelete}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Manage Access Modal */}
      <Modal
        opened={!!accessProject}
        onClose={() => setAccessProject(null)}
        title={`Manage Access — ${accessProject?.name}`}
        size='lg'
      >
        <Stack>
          <Text fw={500} size='sm'>
            Grant Access
          </Text>
          <Flex gap='sm'>
            <Select
              searchable
              placeholder='Select user email'
              value={grantEmail}
              data={activeUserEmails
                .filter((email) => email !== (accessProject?.owner_email ?? ''))
                .map((email) => ({ value: email, label: email }))}
              onChange={(value) => setGrantEmail(value ?? '')}
              style={{ flex: 1 }}
            />
            <Select
              data={[
                { value: 'view', label: 'View' },
                { value: 'edit', label: 'Edit' },
              ]}
              value={grantLevel}
              onChange={(v) => setGrantLevel((v ?? 'view') as AccessLevel)}
              w={100}
            />
            <Button onClick={handleGrantAccess}>Add</Button>
          </Flex>

          {permissions.length > 0 && (
            <Box mt='sm'>
              <Text fw={500} size='sm' mb='xs'>
                Shared With
              </Text>
              <Table>
                <Table.Tbody>
                  {permissions.map((perm) => (
                    <Table.Tr key={perm.id}>
                      <Table.Td>
                        <Text size='sm'>{perm.user_email ?? perm.user_id}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Select
                          size='xs'
                          data={[
                            { value: 'view', label: 'View' },
                            { value: 'edit', label: 'Edit' },
                          ]}
                          value={perm.access_level}
                          onChange={(v) =>
                            handleChangeAccessLevel(
                              perm.user_id,
                              (v ?? 'view') as AccessLevel,
                            )
                          }
                          w={90}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Button
                          size='xs'
                          variant='subtle'
                          color='red'
                          onClick={() => handleRevokeAccess(perm.user_id)}
                        >
                          Remove
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          )}
        </Stack>
      </Modal>
    </>
  )
}
