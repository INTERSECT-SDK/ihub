import {
  test as base,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test'

type DeferredLauncherRequest = {
  promise: Promise<void>
  resolve: () => void
}

type TestUser = {
  email: string
  id: string
  username: string
}

export interface LauncherTourFixture {
  setUser: (user: TestUser) => void
  deferLauncher: () => void
  resolveLauncher: () => void
  setCapabilities: (capabilities: Record<string, unknown>[]) => void
  getCapabilityRequestCount: () => number
  failNextCapabilityRequest: () => void
  emitLifecycleEvent: (page: Page) => Promise<void>
}

type Fixtures = {
  launcherTour: LauncherTourFixture
  page: Page
}

const defaultUser: TestUser = {
  email: 'launcher-tour@example.com',
  id: 'launcher-tour-user',
  username: 'launcher-tour',
}

class StatefulLauncherTourFixture {
  readonly controls: LauncherTourFixture
  private user = defaultUser
  private launcherGate: DeferredLauncherRequest | undefined
  private capabilities: Record<string, unknown>[] = []
  private capabilityRequestCount = 0
  private shouldFailNextCapabilityRequest = false

  constructor() {
    this.controls = {
      setUser: (user) => {
        this.user = user
      },
      deferLauncher: () => {
        let resolve: () => void = () => undefined
        const promise = new Promise<void>((done) => {
          resolve = done
        })
        this.launcherGate = { promise, resolve }
      },
      resolveLauncher: () => {
        this.launcherGate?.resolve()
        this.launcherGate = undefined
      },
      setCapabilities: (capabilities) => {
        this.capabilities = capabilities
      },
      getCapabilityRequestCount: () => this.capabilityRequestCount,
      failNextCapabilityRequest: () => {
        this.shouldFailNextCapabilityRequest = true
      },
      emitLifecycleEvent: async (page) => {
        await page.evaluate(() => {
          window.dispatchEvent(new Event('ihub-test-lifecycle-event'))
        })
      },
    }
  }

  async route(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    const pathname = url.pathname

    if (url.hostname !== '127.0.0.1') {
      await route.continue()
      return
    }

    if (pathname === '/api/v1/auth/user') {
      await fulfillJson(route, 200, {
        sub: this.user.id,
        given_name: 'Launcher',
        family_name: 'Tour',
        preferred_username: this.user.username,
        email: this.user.email,
        role: 'user',
        exp: '4102444800',
      })
      return
    }

    if (/^\/api\/v1\/jupyterhub\/[^/]+\/server$/.test(pathname)) {
      await fulfillJson(route, 200, {
        '': { ready: true, pending: null },
      })
      return
    }

    if (/^\/api\/v1\/jupyterhub\/[^/]+\/token$/.test(pathname)) {
      await fulfillJson(route, 200, { token: 'launcher-tour-token' })
      return
    }

    if (pathname === '/api/v1/projects/active-users') {
      await fulfillJson(route, 200, [this.user.email])
      return
    }

    if (/^\/api\/v1\/projects\/[^/]+$/.test(pathname)) {
      const projectId = decodeURIComponent(pathname.split('/').at(-1) ?? '')
      await fulfillJson(route, 200, {
        id: projectId,
        name: `Project ${projectId}`,
        description: null,
        visibility: 'private',
        owner_id: this.user.id,
        owner_email: this.user.email,
        current_user_access_level: 'edit',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      })
      return
    }

    if (pathname === '/api/v1/projects/') {
      await fulfillJson(route, 200, [])
      return
    }

    if (pathname === '/api/v1/services') {
      const gate = this.launcherGate
      if (gate) {
        await gate.promise
      }
      await fulfillJson(route, 200, [
        { id: 1, broker_id: 1 },
        { id: 2, broker_id: 2 },
        { id: 3, broker_id: null },
      ])
      return
    }

    if (pathname === '/api/v1/brokers') {
      await fulfillJson(route, 200, [
        { id: 1, label: 'Zulu Broker', status: 'connected' },
        { id: 2, label: 'Alpha Broker', status: 'connected' },
      ])
      return
    }

    if (pathname === '/api/v1/capabilities') {
      this.capabilityRequestCount += 1
      if (this.shouldFailNextCapabilityRequest) {
        this.shouldFailNextCapabilityRequest = false
        await fulfillJson(route, 503, { detail: 'Forced refresh failure' })
        return
      }
      const serviceId = url.searchParams.get('service_id')
      const capabilities = serviceId
        ? this.capabilities.filter(
            (capability) => String(capability.service_id) === serviceId,
          )
        : this.capabilities
      await fulfillJson(route, 200, capabilities)
      return
    }

    if (/^\/api\/v1\/services\/service\/\d+$/.test(pathname)) {
      const serviceId = Number(pathname.split('/').at(-1))
      await fulfillJson(route, 200, {
        id: serviceId,
        name: `service-${serviceId}`,
        organization: 'org',
        facility: 'facility',
        system: 'system',
        subsystem: 'subsystem',
      })
      return
    }

    if (pathname === '/api/v1/contents/upload-policy') {
      await fulfillJson(route, 200, {
        supported_extensions: ['.icmp', '.ipynb', '.ichat', '.txt'],
        max_file_size_bytes: 1_048_576,
      })
      return
    }

    const contentsMarker = '/api/contents/'
    const contentsIndex = pathname.indexOf(contentsMarker)
    if (pathname.startsWith('/ijupyterhub/user/') && contentsIndex !== -1) {
      const logicalPath = decodePath(
        pathname.slice(contentsIndex + contentsMarker.length),
      )
      const isDirectory = logicalPath.split('/').length === 2

      await fulfillJson(route, 200, {
        name: logicalPath.split('/').at(-1),
        path: logicalPath,
        type: isDirectory ? 'directory' : 'file',
        format: isDirectory ? 'json' : 'text',
        content: isDirectory ? [] : 'Tour document',
        writable: true,
        created: '2026-01-01T00:00:00.000Z',
        last_modified: '2026-01-01T00:00:00.000Z',
        mimetype: isDirectory ? undefined : 'text/plain',
      })
      return
    }

    await route.continue()
  }
}

function decodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/')
}

async function fulfillJson(
  route: Route,
  status: number,
  body: unknown,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function installRouting(
  context: BrowserContext,
  fixture: StatefulLauncherTourFixture,
): Promise<void> {
  await context.addInitScript(() => {
    class TestEventSource {
      onerror: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onopen: ((event: Event) => void) | null = null
      private readonly emit = () => {
        this.onmessage?.(new MessageEvent('message', { data: '{}' }))
      }

      constructor() {
        window.addEventListener('ihub-test-lifecycle-event', this.emit)
        queueMicrotask(() => this.onopen?.(new Event('open')))
      }

      close(): void {
        window.removeEventListener('ihub-test-lifecycle-event', this.emit)
      }
    }

    Object.defineProperty(window, 'EventSource', {
      configurable: true,
      value: TestEventSource,
    })
  })
  await context.addCookies([
    {
      name: 'IHUB_SESSION',
      value: 'launcher-tour-session',
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  await context.route('**/*', (route) => fixture.route(route))
}

export const test = base.extend<Fixtures>({
  launcherTour: async ({ context }, provide) => {
    const fixture = new StatefulLauncherTourFixture()
    await installRouting(context, fixture)
    await provide(fixture.controls)
    await context.unroute('**/*')
  },
  page: async ({ page, launcherTour }, provide) => {
    void launcherTour
    await provide(page)
  },
})

export { expect } from '@playwright/test'
