'use client'

import {
  Anchor,
  Card,
  CardSection,
  Container,
  Image,
  Text,
  rem,
} from '@mantine/core'
import { useEffect, useState } from 'react'

const SUPPORT_EMAIL = 'ihub-support@ornl.gov'

function reasonMessage(reason?: string): string {
  if (reason === 'missing_email') {
    return 'Your identity provider account did not return an email address, so access could not be evaluated.'
  }
  if (reason === 'not_authorized') {
    return 'Your account was authenticated, but it is not authorized to access iHub.'
  }
  return 'Your account does not currently have access to iHub.'
}

export default function UnauthorizedPage() {
  const [reason, setReason] = useState<string | undefined>(undefined)
  const [email, setEmail] = useState<string | undefined>(undefined)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setReason(params.get('reason') ?? undefined)
    setEmail(params.get('email') ?? undefined)
  }, [])

  return (
    <Container size={420} py={rem(50)}>
      <Card withBorder shadow='md' radius='xl'>
        <CardSection>
          <Image
            src='/hub/intersect_logo_a_white.svg'
            width={rem(120)}
            height='auto'
            fit='contain'
            bg='var(--mantine-color-gray-9)'
            p='xl'
          />
        </CardSection>

        <CardSection p='xl'>
          <Text fw={700} size='lg' mb='xs'>
            Access Required
          </Text>
          <Text c='dimmed' size='sm'>
            {reasonMessage(reason)}
          </Text>
        </CardSection>
      </Card>

      <Text mt='md' c='dimmed' size='sm'>
        Need access? contact us at{' '}
        <Anchor href={`mailto:${SUPPORT_EMAIL}`} size='sm'>
          {SUPPORT_EMAIL}
        </Anchor>
      </Text>
    </Container>
  )
}
