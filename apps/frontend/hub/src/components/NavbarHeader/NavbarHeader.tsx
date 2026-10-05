'use client'

import { HeaderNavbar } from '@ihub/ui'
import Link from 'next/link'
import Image from 'next/image'
import AuthButtons from '../AuthButton/AuthButton.js'
import { useSession } from '@/app/providers/SessionProvider.tsx'

export default function Navbar() {
  const session = useSession()

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
      authItem={<AuthButtons session={session}></AuthButtons>}
    />
  )
}
