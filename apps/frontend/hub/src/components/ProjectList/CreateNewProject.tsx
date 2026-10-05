'use client'

import { listOfProjectsAtom } from '@/atoms/global'
import { useSession } from '@/app/providers/SessionProvider.tsx'
import { Project, ProjectCreate } from '@ihub/utils/types/project'
import { AccessLevel } from '@ihub/utils/types/project'
import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { useAtom } from 'jotai'
import { useEffect, useState } from 'react'

export function CreateNewProject() {
  const [, setListOfProjects] = useAtom(listOfProjectsAtom)
  const { session } = useSession()
  const userEmail = (session?.user?.email ?? '').toLowerCase()
  const [opened, setOpened] = useState(false)
  const [name, setName] = useState('')
  const [activeUserEmails, setActiveUserEmails] = useState<string[]>([])
  const [shareEmail, setShareEmail] = useState<string | null>(null)
  const [shareLevel, setShareLevel] = useState<AccessLevel>('view')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!opened) return
    fetchActiveUsers()
  }, [opened])

  async function fetchActiveUsers() {
    try {
      const res = await fetch('/api/v1/projects/active-users')
      if (!res.ok) return
      const emails: string[] = await res.json()
      setActiveUserEmails(emails)
    } catch (e) {
      console.error('Failed to fetch active users', e)
    }
  }

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    setLoading(true)
    try {
      const body: ProjectCreate = { name: trimmed }
      const res = await fetch('/api/v1/projects/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const created: Project = await res.json()
        if (shareEmail) {
          await fetch(`/api/v1/projects/${created.id}/permissions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_email: shareEmail,
              access_level: shareLevel,
            }),
          })
        }
        setListOfProjects((prev) => (prev ? [created, ...prev] : [created]))
        setOpened(false)
        setName('')
        setShareEmail(null)
        setShareLevel('view')
      } else {
        console.error('Failed to create project', await res.text())
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button bdrs='xl' onClick={() => setOpened(true)}>
        New project
      </Button>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title='New Project'
      >
        <Stack>
          <TextInput
            label='Project Name'
            placeholder='My Research Project'
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            data-autofocus
          />
          <Text size='sm' fw={500} mt='xs'>
            Share now (optional)
          </Text>
          <Group grow>
            <Select
              searchable
              clearable
              placeholder='Select active user email'
              data={activeUserEmails
                .filter((email) => email.toLowerCase() !== userEmail)
                .map((email) => ({ value: email, label: email }))}
              value={shareEmail}
              onChange={setShareEmail}
            />
            <Select
              data={[
                { value: 'view', label: 'View' },
                { value: 'edit', label: 'Edit' },
              ]}
              value={shareLevel}
              onChange={(value) =>
                setShareLevel((value ?? 'view') as AccessLevel)
              }
              disabled={!shareEmail}
            />
          </Group>
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              loading={loading}
              disabled={!name.trim()}
            >
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
