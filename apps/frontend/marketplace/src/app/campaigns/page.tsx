'use client'
import Link from 'next/link'
import { Container, Text, Button } from '@mantine/core'

export default function CampaignsPage() {
  return (
    <div className='bg-gray-100 min-h-screen'>
      <Container
        size='md'
        className='flex flex-col items-center justify-center text-center'
        style={{ minHeight: '100vh' }}
      >
        <Text size='xl' className='text-gray-700' fw={'bold'} mb='md'>
          Coming Soon
        </Text>
        <Text size='lg' className='text-gray-600' mb='xl'>
          The campaigns page will be available soon.
        </Text>
        <Button size='lg' radius='xl' component={Link} href='/'>
          Back to Home
        </Button>
      </Container>
    </div>
  )
}
