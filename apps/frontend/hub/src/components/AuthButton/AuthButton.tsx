'use client'

import { SessionInterface } from '@/app/providers/SessionProvider.tsx'
import { Avatar, Group, Menu, UnstyledButton } from '@mantine/core'
import { IconChevronDown, IconLogout } from '@tabler/icons-react'
import { useRouter } from 'next/navigation.js'

export default function AuthButtons({
  session,
}: {
  session?: SessionInterface | null
  showAsPanel?: boolean
}) {
  const router = useRouter()
  const user = session?.session?.user
  const isAuthenticated = Boolean(user)

  if (isAuthenticated) {
    return (
      <Menu
        width={260}
        position='bottom-end'
        transitionProps={{ transition: 'pop-top-right' }}
        withinPortal
      >
        <Menu.Target>
          <UnstyledButton>
            <Group gap={7}>
              <Avatar color='blue' radius='xl' size={30}>
                {user?.firstName?.[0]}
                {user?.lastName?.[0]}
              </Avatar>
              <IconChevronDown size={14} stroke={1.5} />
            </Group>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown onClick={() => router.push('/logout')}>
          <Menu.Item leftSection={<IconLogout size={16} stroke={1.5} />}>
            Logout
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    )
  }
}
