import { NextResponse, type NextRequest } from 'next/server'

const SESSION_COOKIE_NAME = 'IHUB_SESSION'
const HUB_BASE_PATH = '/hub'
const protectedPrefixes = ['/project']
const guardedExactPaths = ['/auth', '/logout']

function stripBasePath(pathname: string): string {
  if (pathname === HUB_BASE_PATH) {
    return '/'
  }

  if (pathname.startsWith(`${HUB_BASE_PATH}/`)) {
    return pathname.slice(HUB_BASE_PATH.length)
  }

  return pathname
}

function isGuardedPath(pathname: string): boolean {
  if (guardedExactPaths.includes(pathname)) {
    return true
  }

  return protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export function proxy(request: NextRequest) {
  const pathname = stripBasePath(request.nextUrl.pathname)

  if (!isGuardedPath(pathname)) {
    return NextResponse.next()
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)
  if (sessionCookie) {
    return NextResponse.next()
  }

  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.search = ''
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
}
