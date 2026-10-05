'use client'

import {
  Button,
  Group,
  Text,
  Anchor,
  Container,
  Image,
  rem,
  Card,
  CardSection,
} from '@mantine/core'

function signInSSO(): string {
  return '/api/v1/auth'
}

export default function LoginPage() {
  return (
    <Container size={420} py={rem(50)}>
      <Card withBorder shadow='md' radius={'xl'}>
        <CardSection>
          <Image
            src='/hub/intersect_logo_a_white.svg'
            width={rem(120)}
            height='auto'
            bg={'var(--mantine-color-gray-9)'}
            p={'xl'}
          />
        </CardSection>

        <CardSection p={'xl'}>
          <Group my={'md'}>
            <Button
              type='submit'
              component='a'
              href={signInSSO()}
              fullWidth
              size='md'
              radius={'xl'}
              color={'var(--mantine-color-gray-3)'}
              c={'dark'}
            >
              Sign In with OIDC
            </Button>
          </Group>
        </CardSection>
      </Card>

      <Text mt='md' c='dimmed' size='sm'>
        Need help? contact us at{' '}
        <Anchor href='mailto:ihub-support@ornl.gov' size='sm'>
          ihub-support@ornl.gov
        </Anchor>
      </Text>
    </Container>
  )
}
