'use client'

import { HeaderNavbar } from '@ihub/ui'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@mantine/core'

export function HeaderNav() {
  return (
    <HeaderNavbar
      logoItem={
        <Link href='/'>
          <Image
            src='/hub/intersect_logo_b_white.svg'
            alt='INTERSECT Logo'
            width={200} // Specify intrinsic width
            height={50} // Specify intrinsic height
          />
        </Link>
      }
      authItem={
        <a href='/hub'>
          <Button radius={'xl'}>Launch iHub</Button>
        </a>
      }
    />
  )
}
