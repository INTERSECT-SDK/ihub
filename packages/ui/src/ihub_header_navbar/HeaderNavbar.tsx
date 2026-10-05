'use client'

import {
  Burger,
  Divider,
  Drawer,
  Flex,
  Group,
  ScrollArea,
  Text,
  ThemeIcon,
  UnstyledButton,
  useMantineTheme,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import classes from './style.module.css'

interface MenuItem {
  icon: any
  title: string
  description: string
}

export default function HeaderNavbar({
  leftItems,
  rightItems,
  authItem,
  logoItem,
}: {
  leftItems?: MenuItem[]
  rightItems?: MenuItem[]
  authItem?: React.ReactNode
  logoItem?: React.ReactNode
}) {
  const [drawerOpened, { toggle: toggleDrawer, close: closeDrawer }] =
    useDisclosure(false)
  const [linksOpened, { toggle: toggleLinks }] = useDisclosure(false)
  const theme = useMantineTheme()

  const leftLinks = leftItems?.map((item) => (
    <UnstyledButton className={classes.subLink} key={item.title}>
      <Group wrap='nowrap' align='flex-start'>
        <ThemeIcon size={34} variant='default' radius='md'>
          <item.icon size={22} color={theme.colors.blue[9]} />
        </ThemeIcon>
        <div>
          <Text size='sm' fw={500}>
            {item.title}
          </Text>
          <Text size='xs' c='dimmed'>
            {item.description}
          </Text>
        </div>
      </Group>
    </UnstyledButton>
  ))

  const rightLinks = rightItems?.map((item) => (
    <UnstyledButton className={classes.subLink} key={item.title}>
      <Group wrap='nowrap' align='flex-start'>
        <ThemeIcon size={34} variant='default' radius='md'>
          <item.icon size={22} color={theme.colors.blue[9]} />
        </ThemeIcon>
        <div>
          <Text size='sm' fw={500}>
            {item.title}
          </Text>
          <Text size='xs' c='dimmed'>
            {item.description}
          </Text>
        </div>
      </Group>
    </UnstyledButton>
  ))

  return (
    <>
      <header className={classes.header}>
        <Group justify='space-between' mx='auto' h='100%' px='lg'>
          <div>{logoItem}</div>

          <Group h='100%' gap={0} visibleFrom='sm'>
            {leftLinks}
          </Group>

          <Group visibleFrom='sm'>
            {rightLinks}
            {authItem}
          </Group>

          <Burger
            opened={drawerOpened}
            onClick={toggleDrawer}
            hiddenFrom='sm'
            className={classes.burger}
          />
        </Group>
      </header>

      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        size='100%'
        padding='md'
        title='Navigation'
        hiddenFrom='sm'
        zIndex={1000000}
        classNames={{
          root: classes.drawer,
        }}
      >
        <ScrollArea h='calc(100vh - 80px' mx='-md'>
          <Divider my='sm' />

          {leftLinks}
          {rightLinks}

          <Divider my='sm' />

          <Group justify='center' grow pb='xl' px='md'></Group>
        </ScrollArea>
      </Drawer>
    </>
  )
}
