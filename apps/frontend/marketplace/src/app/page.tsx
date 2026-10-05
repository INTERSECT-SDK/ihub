'use client'
import Link from 'next/link'
import { Container, TextInput, Card, Text, Button, Group } from '@mantine/core'
import {
  IconSearch,
  IconArrowRight,
  IconBulb,
  IconRocket,
  IconRobot,
  IconDatabase,
} from '@tabler/icons-react'

const cards = [
  {
    title: 'Capabilities',
    subtitle: 'Explore scientific capabilities',
    icon: <IconBulb size={32} />,
    count: '10+ items',
    href: '/capabilities',
  },
  {
    title: 'Data Sources',
    subtitle: 'Browse available data sources',
    icon: <IconDatabase size={32} />,
    count: '10+ items',
    href: '/data-sources',
  },
  {
    title: 'Campaigns',
    subtitle: 'View all scientific campaigns',
    icon: <IconRocket size={32} />,
    count: '10+ items',
    href: '/campaigns',
  },
  {
    title: 'AI Agents',
    subtitle: 'Browse available AI agents',
    icon: <IconRobot size={32} />,
    count: '10+ items',
    href: '/agents',
  },
]

export default function Marketplace() {
  return (
    <div className='bg-gray-100 min-h-screen flex flex-col'>
      {/* Hero and tiles blend section */}
      <div
        className='flex flex-col flex-1'
        style={{
          backgroundImage:
            'linear-gradient(to bottom, rgba(122, 144, 170, 1) 0%, rgba(196, 205, 216, 0.8) 25%, rgba(243, 244, 246, 0.5) 50%, rgba(243, 244, 246, 0) 100%)',
        }}
      >
        {/* Hero banner */}
        <div
          className='relative w-full overflow-hidden shrink-0'
          style={{
            background:
              'linear-gradient(180deg, #000308 0%, #010720 30%, #020c1e 52%, #071628 62%, #1a2e48 72%, #3d5270 80%, #7a90aa 88%, #c4cdd8 94%, #f3f4f6 100%)',
          }}
        >
          {/* Broad violet crown glow */}
          <div
            className='absolute inset-0 pointer-events-none'
            style={{
              background:
                'radial-gradient(ellipse 70% 40% at 50% -10%, rgba(20,60,160,0.18) 0%, transparent 65%)',
            }}
          />
          {/* Tight white spotlight on logo */}
          <div
            className='absolute inset-0 pointer-events-none'
            style={{
              background:
                'radial-gradient(ellipse 22% 45% at 50% 18%, rgba(140,180,255,0.04) 0%, transparent 55%)',
            }}
          />
          {/* Side vignette */}
          <div
            className='absolute inset-0 pointer-events-none'
            style={{
              background:
                'linear-gradient(90deg, rgba(0,0,0,0.7) 0%, transparent 20%, transparent 80%, rgba(0,0,0,0.7) 100%)',
            }}
          />
          {/* Bottom dissolve into page */}
          <div
            className='absolute bottom-0 left-0 right-0 pointer-events-none'
            style={{
              height: '160px',
              background:
                'linear-gradient(to bottom, rgba(243,244,246,0) 0%, rgba(243,244,246,0.06) 20%, rgba(243,244,246,0.25) 40%, rgba(243,244,246,0.58) 62%, rgba(243,244,246,0.84) 80%, rgba(243,244,246,1) 100%)',
            }}
          />

          <div className='relative z-10 flex flex-col items-center px-8 pt-14 pb-40'>
            <img
              src='/intersect_logo_a_white.svg'
              alt='INTERSECT'
              style={{
                width: 'min(680px, 78vw)',
                display: 'block',
                filter: [
                  'drop-shadow(0 0 1px rgba(255,255,255,0.95))',
                  'drop-shadow(0 0 16px rgba(60,110,220,0.35))',
                  'drop-shadow(0 10px 52px rgba(0,10,60,0.85))',
                ].join(' '),
              }}
            />
          </div>
        </div>

        <div className='relative w-full overflow-hidden flex-1 flex flex-col justify-center items-center'>
          <div
            className='absolute inset-0 pointer-events-none'
            style={{
              backgroundImage: "url('/tiles_art.svg')",
              backgroundRepeat: 'repeat',
              backgroundPosition: 'center',
              backgroundSize: '360px auto',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent 0%, black 16%, black 84%, transparent 100%)',
              maskImage:
                'linear-gradient(to bottom, transparent 0%, black 16%, black 84%, transparent 100%)',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
            }}
          />
          <Container
            size='md'
            className='relative z-10 h-full flex-col items-center justify-center text-center'
            py={'xl'}
            my={'xl'}
          >
            <Text size='xl' className='text-gray-700' fw={'bold'} mb='md'>
              iHub: Scientists&apos; Gateway into the INTERSECT Ecosystem
            </Text>
            <Button
              size='lg'
              radius='xl'
              mb='xl'
              mx={'md'}
              component='a'
              href='/hub'
            >
              Launch iHub
            </Button>

            <Button
              size='lg'
              variant='light'
              radius='xl'
              mb='xl'
              mx={'md'}
              component='a'
              href='/docs'
              rel='noopener noreferrer'
            >
              Documentation
            </Button>
          </Container>
        </div>
      </div>

      {/* <Container size='md' className='text-center' my={'xl'} py={'xl'}>
        <Text size='lg' className='text-blue-800' fw={'bold'} mb='lg'>
          Discover, share, and collaborate on cutting-edge scientific
          capabilities, campaigns, and AI agents.
        </Text>
        <TextInput
          leftSection={<IconSearch size={18} />}
          placeholder='Search capabilities, campaigns, or agents...'
          size='md'
          radius='md'
          mb={56}
        />
        <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
          {cards.map((card) => (
            <Card
              key={card.title}
              component={Link}
              shadow='sm'
              padding='lg'
              radius='md'
              className='cursor-pointer hover:shadow-lg transition-shadow'
              href={card.href}
            >
              <div className='flex items-center mb-4'>{card.icon}</div>
              <Text fw={600} size='lg' mb='sm' className='text-left'>
                {card.title}
              </Text>
              <Text size='sm' mb='xl' className='text-left text-gray-600'>
                {card.subtitle}
              </Text>
              <Group justify='space-between'>
                <Text size='sm' className='text-gray-600'>
                  {card.count}
                </Text>
                <Button
                  rightSection={<IconArrowRight size={16} />}
                  variant='light'
                  radius={'xl'}
                >
                  Explore
                </Button>
              </Group>
            </Card>
          ))}
        </div>
      </Container> */}

      {/* Footer */}
      <footer
        style={{
          background: '#000308',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}
        className='w-full'
      >
        <Container size='lg' className='py-24 px-8'>
          <div className='grid grid-cols-1 md:grid-cols-4 gap-12'>
            {/* Logo */}
            <div className='flex flex-col items-start'>
              <img
                src='/ornl_logo_white.svg'
                alt='ORNL Logo'
                style={{
                  width: '120px',
                  height: 'auto',
                  marginBottom: '16px',
                  opacity: 0.9,
                }}
              />
            </div>

            <div>
              <Text fw={600} size='sm' color='white' mb='md'>
                Platform
              </Text>
              <div className='flex flex-col gap-3'>
                <a
                  href='/hub'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-gray-400 hover:text-white transition-colors text-sm'
                >
                  iHub
                </a>
                <a
                  href='/docs'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-gray-400 hover:text-white transition-colors text-sm'
                >
                  Documentation
                </a>
                <a
                  href='https://intersect-python-sdk.readthedocs.io/'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-gray-400 hover:text-white transition-colors text-sm'
                >
                  INTERSECT SDK
                </a>
              </div>
            </div>

            {/* Quick Links */}
            <div>
              <Text fw={600} size='sm' color='white' mb='md'>
                About
              </Text>
              <div className='flex flex-col gap-3'>
                <a
                  href='https://www.ornl.gov/intersect'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-gray-400 hover:text-white transition-colors text-sm'
                >
                  INTERSECT Initiative
                </a>
                <a
                  href='/about/team'
                  className='text-gray-400 hover:text-white transition-colors text-sm'
                >
                  iHub Team
                </a>
                <a
                  href='/about/use_cases'
                  className='text-gray-400 hover:text-white transition-colors text-sm'
                >
                  Use Cases
                </a>
              </div>
            </div>

            {/* Contact */}
            <div>
              <Text fw={600} size='sm' color='white' mb='md'>
                Contact
              </Text>
              <div className='flex flex-col gap-4'>
                <a
                  href='mailto:ihub-support@ornl.gov'
                  className='text-gray-400 hover:text-white transition-colors text-sm break-all'
                >
                  ihub-support@ornl.gov
                </a>
              </div>
            </div>
          </div>
        </Container>
      </footer>
    </div>
  )
}
