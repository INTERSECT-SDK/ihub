'use client'

import Navbar from '@/components/NavbarHeader/NavbarHeader.js'
import { CreateNewProject } from '@/components/ProjectList/CreateNewProject.js'
import ListOfProjects from '@/components/ProjectList/ProjectList.js'
import { Card, Container, Group, Text } from '@mantine/core'

export default function ProjectApp() {
  return (
    <>
      <Navbar />
      <Container>
        <Card>
          <Group justify='space-between'>
            <Text size='xl'>Projects</Text>
            <CreateNewProject />
          </Group>
          <ListOfProjects />
        </Card>
      </Container>
    </>
  )
}
