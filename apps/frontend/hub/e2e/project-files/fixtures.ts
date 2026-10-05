import {
  expect,
  test as base,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  type Route,
} from '@playwright/test'

import { getLauncherTourMarkerKey } from '../../src/components/LauncherTour/launcher-tour.ts'

const TEST_USER_ID = 'playwright-user'
const TEST_IDENTITY = 'playwright.user@example.com'
const TEST_TOKEN = 'project-files-playwright-token'
const TEST_PROJECT_ID = 'project-files-e2e'
const TEST_PROJECT_ROOT = `projects/${TEST_PROJECT_ID}`

type ControlledOperation = 'upload' | 'rename' | 'save'
type FailableOperation = ControlledOperation | 'load'
type CampaignRunStatus = 'ACTIVE' | 'COMPLETED'
type LoggedOperation =
  | ControlledOperation
  | 'download'
  | 'jupyter-server'
  | 'jupyter-token'
  | 'list'
  | 'load'
  | 'session'

interface ContentModel {
  name: string
  path: string
  type: 'directory' | 'file'
  format: 'json' | 'text'
  content: unknown
  writable: boolean
  created: string
  last_modified: string
  mimetype?: string
}

export interface RequestLogEntry {
  operation: LoggedOperation
  method: string
  logicalPath: string
  body: unknown
  order: number
  completionOrder?: number
  status?: number
}

interface RequestWaitOptions {
  afterOrder?: number
  logicalPath?: string
}

interface DeferredGate {
  operation: ControlledOperation
  resolve: () => void
  promise: Promise<void>
}

interface RequestWaiter {
  operation: LoggedOperation
  options: RequestWaitOptions
  resolve: (entry: RequestLogEntry) => void
}

export interface ProjectFilesFixture {
  projectId: string
  projectRoot: string
  contentPath: (relativePath: string) => string
  deferNext: (operation: ControlledOperation) => string
  failNext: (operation: FailableOperation) => void
  failLoadsFor: (logicalPath: string) => void
  resolveDeferred: (token: string) => void
  openProjectFiles: (page: Page) => Promise<void>
  readRequestLog: () => RequestLogEntry[]
  readPersistedContent: (relativePath: string) => unknown
  setCampaignRunStatus: (status: CampaignRunStatus) => void
  row: (page: Page, logicalPath: string) => Locator
  waitForRequest: (
    operation: LoggedOperation,
    options?: RequestWaitOptions,
  ) => Promise<RequestLogEntry>
}

interface Fixtures {
  projectFiles: ProjectFilesFixture
}

class StatefulProjectFilesFixture {
  readonly controls: ProjectFilesFixture

  private readonly tree = new Map<string, ContentModel>()
  private readonly deferredByOperation = new Map<
    ControlledOperation,
    string[]
  >()
  private readonly deferredGates = new Map<string, DeferredGate>()
  private readonly requestLog: RequestLogEntry[] = []
  private readonly failures = new Map<FailableOperation, number>()
  private readonly loadFailurePaths = new Set<string>()
  private readonly waiters: RequestWaiter[] = []
  private eventOrder = 0
  private deferredId = 0
  private campaignRunStatus: CampaignRunStatus = 'ACTIVE'

  constructor() {
    this.seedDefaults()
    this.controls = {
      projectId: TEST_PROJECT_ID,
      projectRoot: TEST_PROJECT_ROOT,
      contentPath: (relativePath) => `${TEST_PROJECT_ROOT}/${relativePath}`,
      deferNext: (operation) => this.deferNext(operation),
      failNext: (operation) => {
        this.failures.set(operation, (this.failures.get(operation) ?? 0) + 1)
      },
      failLoadsFor: (logicalPath) => {
        this.loadFailurePaths.add(logicalPath)
      },
      resolveDeferred: (token) => this.resolveDeferred(token),
      openProjectFiles: (page) => this.openProjectFiles(page),
      readRequestLog: () => this.requestLog.map((entry) => ({ ...entry })),
      readPersistedContent: (relativePath) =>
        structuredClone(
          this.tree.get(`${TEST_PROJECT_ROOT}/${relativePath}`)?.content,
        ),
      setCampaignRunStatus: (status) => {
        this.campaignRunStatus = status
      },
      row: (page, logicalPath) =>
        page.locator(`[data-project-file-path=${JSON.stringify(logicalPath)}]`),
      waitForRequest: (operation, options = {}) =>
        this.waitForRequest(operation, options),
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
      const entry = this.beginLog('session', request, pathname)
      await this.fulfillJson(route, entry, 200, {
        sub: TEST_USER_ID,
        given_name: 'Playwright',
        family_name: 'User',
        preferred_username: 'playwright',
        email: TEST_IDENTITY,
        role: 'user',
        exp: '4102444800',
      })
      return
    }

    if (/^\/api\/v1\/jupyterhub\/[^/]+\/server$/.test(pathname)) {
      const entry = this.beginLog('jupyter-server', request, pathname)
      await this.fulfillJson(route, entry, 200, {
        '': { ready: true, pending: null },
      })
      return
    }

    if (/^\/api\/v1\/jupyterhub\/[^/]+\/token$/.test(pathname)) {
      const entry = this.beginLog('jupyter-token', request, pathname)
      await this.fulfillJson(route, entry, 200, { token: TEST_TOKEN })
      return
    }

    if (pathname === `/api/v1/projects/${TEST_PROJECT_ID}`) {
      await this.fulfillJson(route, undefined, 200, {
        id: TEST_PROJECT_ID,
        name: 'Project Files E2E',
        description: null,
        visibility: 'private',
        owner_id: TEST_USER_ID,
        owner_email: TEST_IDENTITY,
        current_user_access_level: 'edit',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      })
      return
    }

    if (pathname === '/api/v1/contents/upload-policy') {
      await this.fulfillJson(route, undefined, 200, {
        supported_extensions: ['.txt', '.json'],
        max_file_size_bytes: 1_048_576,
      })
      return
    }

    if (pathname === '/api/v1/campaign/runs') {
      const requestedStatuses = url.searchParams.getAll('status')
      const requestedCampaignId = url.searchParams.get('campaign_id')
      const includeRun =
        requestedStatuses.includes(this.campaignRunStatus) &&
        (!requestedCampaignId || requestedCampaignId === 'campaign-active')
      await this.fulfillJson(
        route,
        undefined,
        200,
        includeRun
          ? [
              {
                id: 1,
                user_email: TEST_IDENTITY,
                campaign_id: 'campaign-active',
                run_id: 'run-active',
                run_at: '2026-01-01T00:00:00.000Z',
                orchestrator_url: 'http://orchestrator',
                status: this.campaignRunStatus,
                ended_at:
                  this.campaignRunStatus === 'ACTIVE'
                    ? null
                    : '2026-01-01T00:05:00.000Z',
                campaign_name: 'Active Campaign',
                broker_id: 1,
              },
            ]
          : [],
      )
      return
    }

    if (
      pathname === '/api/v1/services' ||
      pathname === '/api/v1/brokers' ||
      pathname === '/api/v1/capabilities'
    ) {
      await this.fulfillJson(route, undefined, 200, [])
      return
    }

    if (pathname.startsWith('/api/v1/contents/save/')) {
      await this.handleUpload(route, request, url)
      return
    }

    if (pathname.startsWith('/api/v1/contents/rename/')) {
      await this.handleRename(route, request, pathname)
      return
    }

    if (pathname.startsWith('/api/v1/contents/download/')) {
      await this.handleDownload(route, request, pathname)
      return
    }

    const contentsMarker = '/api/contents/'
    const contentsIndex = pathname.indexOf(contentsMarker)
    if (pathname.startsWith('/ijupyterhub/user/') && contentsIndex !== -1) {
      const logicalPath = decodePath(
        pathname.slice(contentsIndex + contentsMarker.length),
      )
      await this.handleContents(route, request, logicalPath)
      return
    }

    await route.continue()
  }

  private seedDefaults(): void {
    this.seedDirectory(TEST_PROJECT_ROOT)
    this.seedDirectory(`${TEST_PROJECT_ROOT}/nested folder`)
    this.seedDirectory(`${TEST_PROJECT_ROOT}/archive`)
    this.seedFile(
      `${TEST_PROJECT_ROOT}/nested folder/literal#%name.txt`,
      'encoded path content',
    )
    this.seedFile(
      `${TEST_PROJECT_ROOT}/download target.txt`,
      'download target content',
    )
    this.seedFile(`${TEST_PROJECT_ROOT}/existing.txt`, 'existing content')
    this.seedFile(`${TEST_PROJECT_ROOT}/lock.txt`, 'shared lock content')
    this.seedFile(`${TEST_PROJECT_ROOT}/active.icmp`, {
      id: 'campaign-active',
      task_groups: [],
    })
    this.seedFile(`${TEST_PROJECT_ROOT}/inactive.icmp`, {
      campaignId: 'campaign-inactive',
      nodes: [],
      edges: [],
    })
    this.seedFile(`${TEST_PROJECT_ROOT}/navigation.icmp`, {
      id: 'campaign-navigation',
      run_id: 'run-navigation',
      name: 'Navigation save barrier',
      user: TEST_IDENTITY,
      description: '',
      task_groups: [
        {
          id: 'navigation-group',
          group_dependencies: [],
          tasks: [
            {
              id: 'navigation-capability',
              hierarchy: 'org.example.navigation',
              capability: 'Navigation Capability',
              operation_id: 'run',
              event_name: null,
              task_dependencies: [],
              task_objectives: null,
              capability_metadata: {
                id: 'navigation-capability-metadata',
                name: 'Navigation Capability',
                created_at: '2026-01-01T00:00:00.000Z',
                last_lifecycle_message: '2026-01-01T00:00:00.000Z',
                service_id: 1,
                endpoints_schema: { endpoints: {}, description: '' },
              },
              endpoint_channel: {
                publish: {
                  message: { payload: { type: 'object', properties: {} } },
                },
                subscribe: {
                  message: {
                    payload: {
                      type: 'object',
                      properties: {
                        message: {
                          title: 'Message',
                          type: 'string',
                          default: 'original value',
                        },
                      },
                    },
                  },
                },
                events: [],
              },
              manual_input_values: { message: 'original value' },
              ui_position: { x: 100, y: 100 },
            },
          ],
          objectives: [],
        },
      ],
      objectives: null,
      inputs: [],
      outputs: [],
    })
    this.seedFile(`${TEST_PROJECT_ROOT}/source-controls.icmp`, {
      id: 'campaign-source-controls',
      run_id: 'run-source-controls',
      name: 'Capability source controls',
      user: TEST_IDENTITY,
      description: '',
      task_groups: [
        {
          id: 'source-controls-group',
          group_dependencies: [],
          tasks: [
            {
              id: 'source-capability',
              hierarchy: 'org.example.source',
              capability: 'Source Capability',
              operation_id: 'run',
              event_name: null,
              task_dependencies: [],
              task_objectives: null,
              capability_metadata: {
                id: 'source-capability-metadata',
                name: 'Source Capability',
                created_at: '2026-01-01T00:00:00.000Z',
                last_lifecycle_message: '2026-01-01T00:00:00.000Z',
                service_id: 1,
                endpoints_schema: { endpoints: {}, description: '' },
              },
              endpoint_channel: {
                publish: {
                  message: {
                    payload: {
                      type: 'object',
                      properties: {
                        result: { title: 'Result', type: 'string' },
                      },
                    },
                  },
                },
                subscribe: {
                  message: { payload: { type: 'object', properties: {} } },
                },
                events: [],
              },
              manual_input_values: {},
              ui_position: { x: 560, y: 100 },
            },
            {
              id: 'target-capability',
              hierarchy: 'org.example.target',
              capability: 'Target Capability',
              operation_id: 'run',
              event_name: null,
              task_dependencies: ['source-capability'],
              task_objectives: null,
              capability_metadata: {
                id: 'target-capability-metadata',
                name: 'Target Capability',
                created_at: '2026-01-01T00:00:00.000Z',
                last_lifecycle_message: '2026-01-01T00:00:00.000Z',
                service_id: 1,
                endpoints_schema: { endpoints: {}, description: '' },
              },
              endpoint_channel: {
                publish: {
                  message: { payload: { type: 'object', properties: {} } },
                },
                subscribe: {
                  message: {
                    payload: {
                      type: 'object',
                      properties: {
                        message: { title: 'Message', type: 'string' },
                      },
                    },
                  },
                },
                events: [],
              },
              manual_input_values: {},
              ui_position: { x: 80, y: 100 },
            },
          ],
          objectives: [],
          ui_edges: [
            {
              id: 'source-target-edge',
              source: 'source-capability',
              target: 'target-capability',
              sourceHandle: 'output-right',
              targetHandle: 'input-left',
              type: 'baseCampaignEdge',
              reconnectable: true,
              data: { data_mapping: [], isDependencyEdge: true },
            },
          ],
        },
      ],
      objectives: null,
      inputs: [],
      outputs: [],
    })
  }

  private seedDirectory(path: string): void {
    this.tree.set(path, this.createModel(path, 'directory', null))
  }

  private seedFile(path: string, content: unknown): void {
    this.tree.set(path, this.createModel(path, 'file', content))
  }

  private createModel(
    path: string,
    type: 'directory' | 'file',
    content: unknown,
  ): ContentModel {
    return {
      name: basename(path),
      path,
      type,
      format: type === 'directory' ? 'json' : 'text',
      content,
      writable: true,
      created: '2026-01-01T00:00:00.000Z',
      last_modified: '2026-01-01T00:00:00.000Z',
      mimetype: type === 'file' ? 'text/plain' : undefined,
    }
  }

  private deferNext(operation: ControlledOperation): string {
    const token = `${operation}-${++this.deferredId}`
    let resolve: () => void = () => undefined
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    this.deferredGates.set(token, { operation, promise, resolve })
    const queue = this.deferredByOperation.get(operation) ?? []
    queue.push(token)
    this.deferredByOperation.set(operation, queue)
    return token
  }

  private resolveDeferred(token: string): void {
    const gate = this.deferredGates.get(token)
    if (!gate) {
      throw new Error(`Unknown deferred request: ${token}`)
    }
    gate.resolve()
    this.deferredGates.delete(token)
  }

  private async waitForControl(operation: ControlledOperation): Promise<void> {
    const queue = this.deferredByOperation.get(operation)
    const token = queue?.shift()
    if (!token) {
      return
    }
    if (queue?.length === 0) {
      this.deferredByOperation.delete(operation)
    }
    const gate = this.deferredGates.get(token)
    if (!gate || gate.operation !== operation) {
      throw new Error(`Missing deferred ${operation} request: ${token}`)
    }
    await gate.promise
  }

  private consumeFailure(operation: FailableOperation): boolean {
    const remaining = this.failures.get(operation) ?? 0
    if (remaining === 0) {
      return false
    }
    if (remaining === 1) {
      this.failures.delete(operation)
    } else {
      this.failures.set(operation, remaining - 1)
    }
    return true
  }

  private beginLog(
    operation: LoggedOperation,
    request: Request,
    logicalPath: string,
    body: unknown = null,
  ): RequestLogEntry {
    const entry: RequestLogEntry = {
      operation,
      method: request.method(),
      logicalPath,
      body,
      order: ++this.eventOrder,
    }
    this.requestLog.push(entry)
    for (const waiter of [...this.waiters]) {
      if (matchesWaiter(entry, waiter.operation, waiter.options)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        waiter.resolve({ ...entry })
      }
    }
    return entry
  }

  private completeLog(
    entry: RequestLogEntry | undefined,
    status: number,
  ): void {
    if (!entry) {
      return
    }
    entry.status = status
    entry.completionOrder = ++this.eventOrder
  }

  private waitForRequest(
    operation: LoggedOperation,
    options: RequestWaitOptions,
  ): Promise<RequestLogEntry> {
    const existing = this.requestLog.find((entry) =>
      matchesWaiter(entry, operation, options),
    )
    if (existing) {
      return Promise.resolve({ ...existing })
    }
    return new Promise((resolve) => {
      this.waiters.push({ operation, options, resolve })
    })
  }

  private async openProjectFiles(page: Page): Promise<void> {
    await page.goto(`/hub/project/${TEST_PROJECT_ID}`)
    await expect(
      page.getByText('Restoring your project session...', { exact: true }),
    ).toBeHidden()
    const table = page.getByRole('table', { name: 'Project files' })
    if (!(await table.isVisible())) {
      await page.getByRole('button', { name: 'Project Files' }).click()
    }
    await expect(table).toBeVisible()
  }

  private async handleContents(
    route: Route,
    request: Request,
    logicalPath: string,
  ): Promise<void> {
    if (request.method() === 'PUT') {
      const body = await readJsonBody(request)
      if (body.type === 'directory') {
        this.seedDirectory(logicalPath)
        await this.fulfillJson(
          route,
          undefined,
          200,
          this.tree.get(logicalPath),
        )
        return
      }

      const entry = this.beginLog('save', request, logicalPath, body)
      await this.waitForControl('save')
      if (this.consumeFailure('save')) {
        await this.fulfillJson(route, entry, 500, { detail: 'Forced failure' })
        return
      }

      this.seedFile(logicalPath, parseJupyterContent(body.content))
      await this.fulfillJson(route, entry, 200, this.tree.get(logicalPath))
      return
    }

    const model = this.tree.get(logicalPath)
    if (request.method() !== 'GET') {
      await this.fulfillJson(route, undefined, 405, { detail: 'Not allowed' })
      return
    }
    if (model?.type === 'directory') {
      const entry = this.beginLog('list', request, logicalPath)
      const content = [...this.tree.values()]
        .filter((candidate) => parentPath(candidate.path) === logicalPath)
        .map((candidate) => ({ ...candidate }))
      await this.fulfillJson(route, entry, 200, { ...model, content })
      return
    }
    const entry = this.beginLog('load', request, logicalPath)
    if (this.loadFailurePaths.has(logicalPath) || this.consumeFailure('load')) {
      await this.fulfillJson(route, entry, 500, { detail: 'Forced failure' })
      return
    }
    if (!model) {
      await this.fulfillJson(route, entry, 404, { detail: 'Not found' })
      return
    }
    await this.fulfillJson(route, entry, 200, model)
  }

  private async handleUpload(
    route: Route,
    request: Request,
    url: URL,
  ): Promise<void> {
    const prefix = '/api/v1/contents/save/'
    const logicalPath = decodePath(url.pathname.slice(prefix.length))
    const body = await readJsonBody(request)
    const entry = this.beginLog('upload', request, logicalPath, body)
    const overwrite = url.searchParams.get('overwrite') === 'true'
    if (this.tree.has(logicalPath) && !overwrite) {
      await this.fulfillJson(route, entry, 409, { detail: 'File exists' })
      return
    }
    await this.waitForControl('upload')
    this.seedFile(logicalPath, String(body.content ?? ''))
    await this.fulfillJson(route, entry, 200, this.tree.get(logicalPath))
  }

  private async handleRename(
    route: Route,
    request: Request,
    pathname: string,
  ): Promise<void> {
    const prefix = '/api/v1/contents/rename/'
    const oldPath = decodePath(pathname.slice(prefix.length))
    const body = await readJsonBody(request)
    const newPath = typeof body.path === 'string' ? body.path : ''
    const entry = this.beginLog('rename', request, oldPath, body)
    await this.waitForControl('rename')
    const model = this.tree.get(oldPath)
    if (!model || !newPath) {
      await this.fulfillJson(route, entry, 404, { detail: 'Not found' })
      return
    }
    const renamed = { ...model, name: basename(newPath), path: newPath }
    this.tree.delete(oldPath)
    this.tree.set(newPath, renamed)
    await this.fulfillJson(route, entry, 200, renamed)
  }

  private async handleDownload(
    route: Route,
    request: Request,
    pathname: string,
  ): Promise<void> {
    const prefix = '/api/v1/contents/download/'
    const logicalPath = decodePath(pathname.slice(prefix.length))
    const entry = this.beginLog('download', request, logicalPath)
    const model = this.tree.get(logicalPath)
    if (!model || model.type !== 'file') {
      this.completeLog(entry, 404)
      await route.fulfill({ status: 404, body: 'Not found' })
      return
    }
    this.completeLog(entry, 200)
    await route.fulfill({
      status: 200,
      headers: {
        'content-disposition': `attachment; filename="${model.name}"`,
        'content-type': 'application/octet-stream',
      },
      body: String(model.content),
    })
  }

  private async fulfillJson(
    route: Route,
    entry: RequestLogEntry | undefined,
    status: number,
    body: unknown,
  ): Promise<void> {
    this.completeLog(entry, status)
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  }
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path
}

function parentPath(path: string): string {
  return path.split('/').slice(0, -1).join('/')
}

function decodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/')
}

function parseJupyterContent(content: unknown): unknown {
  if (typeof content !== 'string') {
    return content
  }
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}

function matchesWaiter(
  entry: RequestLogEntry,
  operation: LoggedOperation,
  options: RequestWaitOptions,
): boolean {
  return (
    entry.operation === operation &&
    entry.order > (options.afterOrder ?? 0) &&
    (options.logicalPath === undefined ||
      entry.logicalPath === options.logicalPath)
  )
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const text = request.postData()
  return text ? (JSON.parse(text) as Record<string, unknown>) : {}
}

async function installRouting(
  context: BrowserContext,
  fixture: StatefulProjectFilesFixture,
): Promise<void> {
  await context.addInitScript(
    ([markerKey]) => localStorage.setItem(markerKey, '1'),
    [getLauncherTourMarkerKey(TEST_USER_ID)],
  )
  await context.addCookies([
    {
      name: 'IHUB_SESSION',
      value: 'playwright-session',
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  await context.route('**/*', (route) => fixture.route(route))
}

export const test = base.extend<Fixtures>({
  projectFiles: async ({ context }, provide) => {
    const fixture = new StatefulProjectFilesFixture()
    await installRouting(context, fixture)
    await provide(fixture.controls)
    await context.unroute('**/*')
  },
  page: async ({ page, projectFiles }, provide) => {
    await projectFiles.openProjectFiles(page)
    await provide(page)
  },
})

export { expect }
