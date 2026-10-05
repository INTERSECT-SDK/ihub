import type { Page } from '@playwright/test'

import { expect, test } from './fixtures.ts'

const projectId = 'launcher-tour-project'
const markerPrefix = 'ihub:launcher-tour:auto-started:v1:'

function markerKey(userId: string): string {
  return `${markerPrefix}${encodeURIComponent(userId)}`
}

async function openLauncher(page: Page, id = projectId): Promise<void> {
  await page.goto(`/hub/project/${id}`)
  await expect(
    page.getByText('Restoring your project session...', { exact: true }),
  ).toBeHidden()
}

async function expectTourStarted(page: Page): Promise<void> {
  await expect(page.getByRole('alertdialog')).toContainText('Create a document')
}

async function dismissWith(page: Page, action: 'finish' | 'skip' | 'close') {
  if (action === 'finish') {
    for (let index = 0; index < 6; index += 1) {
      await page.locator('[data-action="primary"]').click()
    }
  } else {
    await page.locator(`[data-action="${action}"]`).click()
  }
  await expect(page.getByRole('alertdialog')).toBeHidden()
}

async function openAccountPanel(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'Account' })
    .evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
}

async function takeTour(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'Take a tour' })
    .evaluate((button: HTMLButtonElement) => button.click())
}

test('auto-start is once per user across projects', async ({
  page,
  launcherTour,
}) => {
  await openLauncher(page)
  await expectTourStarted(page)
  await expect
    .poll(() =>
      page.evaluate(
        (key) => localStorage.getItem(key),
        markerKey('launcher-tour-user'),
      ),
    )
    .toBe('1')

  await dismissWith(page, 'skip')
  await page.reload()
  await expect(page.getByRole('alertdialog')).toBeHidden()

  await openLauncher(page, 'another-project')
  await expect(page.getByRole('alertdialog')).toBeHidden()

  launcherTour.setUser({
    id: 'second/user',
    username: 'second-user',
    email: 'second-user@example.com',
  })
  await page.reload()
  await expectTourStarted(page)
  await expect
    .poll(() =>
      page.evaluate(
        (key) => localStorage.getItem(key),
        markerKey('second/user'),
      ),
    )
    .toBe('1')
})

test('concurrent launcher pages reserve exactly one automatic tour', async ({
  context,
  page,
  launcherTour,
}) => {
  launcherTour.deferLauncher()
  const secondPage = await context.newPage()

  const firstNavigation = page.goto(`/hub/project/${projectId}`)
  const secondNavigation = secondPage.goto(`/hub/project/${projectId}`)

  for (const launcherPage of [page, secondPage]) {
    await expect(
      launcherPage.getByText('Restoring your project session...', {
        exact: true,
      }),
    ).toBeHidden()
    await expect(launcherPage.getByRole('alertdialog')).toBeHidden()
  }

  launcherTour.resolveLauncher()
  await Promise.all([firstNavigation, secondNavigation])

  await expect
    .poll(async () => {
      const visibleTours = await Promise.all(
        [page, secondPage].map((launcherPage) =>
          launcherPage.getByRole('alertdialog').isVisible(),
        ),
      )
      return visibleTours.filter(Boolean).length
    })
    .toBe(1)
  await expect
    .poll(() =>
      page.evaluate(
        (key) => localStorage.getItem(key),
        markerKey('launcher-tour-user'),
      ),
    )
    .toBe('1')
})

for (const action of ['finish', 'skip', 'close'] as const) {
  test(`${action} remains terminal after reload`, async ({ page }) => {
    await openLauncher(page)
    await expectTourStarted(page)
    await dismissWith(page, action)

    await page.reload()
    await expect(page.getByRole('alertdialog')).toBeHidden()
  })
}

test('manual replay ignores an existing marker', async ({ page }) => {
  await page.addInitScript(
    ([key]) => localStorage.setItem(key, '1'),
    [markerKey('launcher-tour-user')],
  )
  await openLauncher(page)
  await expect(page.getByRole('alertdialog')).toBeHidden()

  await openAccountPanel(page)
  await takeTour(page)
  await expectTourStarted(page)
})

test('document applications describe themselves on hover', async ({ page }) => {
  await page.addInitScript(
    ([key]) => localStorage.setItem(key, '1'),
    [markerKey('launcher-tour-user')],
  )
  await openLauncher(page)

  const applicationTooltips = [
    ['Campaign', 'Build and run workflows with INTERSECT capabilities.'],
    ['Notebook', 'Create and run Jupyter notebooks.'],
    ['LLM Chat', 'Chat with iHub agents and assistants.'],
  ] as const

  for (const [application, description] of applicationTooltips) {
    await page.getByRole('button', { name: application, exact: true }).hover()
    await expect(
      page.getByRole('tooltip', { name: description, exact: true }),
    ).toHaveText(description)
  }
})

test('capability tooltips reveal truncated names and preserve lifecycle details', async ({
  page,
  launcherTour,
}) => {
  const staleExplanation =
    'Stale — no lifecycle message has been received from this capability in the last 30 minutes.'
  const currentTimestamp = new Date().toISOString()
  const longOnlineName = 'CompleteOnlineCapabilityName'
  const longStaleName = 'CompleteStaleCapabilityName'
  const shortStaleName = 'Short stale'

  launcherTour.setCapabilities([
    {
      id: 'online-long',
      name: longOnlineName,
      service_id: 1,
      endpoints_schema: {},
      last_lifecycle_message: currentTimestamp,
      lifecycle_last_updated: currentTimestamp,
      lifecycle_error: null,
      lifecycle_error_at: null,
    },
    {
      id: 'stale-long',
      name: longStaleName,
      service_id: 1,
      endpoints_schema: {},
      last_lifecycle_message: null,
      lifecycle_last_updated: null,
      lifecycle_error: null,
      lifecycle_error_at: null,
    },
    {
      id: 'stale-short',
      name: shortStaleName,
      service_id: 1,
      endpoints_schema: {},
      last_lifecycle_message: null,
      lifecycle_last_updated: null,
      lifecycle_error: null,
      lifecycle_error_at: null,
    },
  ])
  await page.addInitScript(
    ([key]) => localStorage.setItem(key, '1'),
    [markerKey('launcher-tour-user')],
  )
  await openLauncher(page)

  const tooltipLines = () =>
    page.getByRole('tooltip').locator('[data-launcher-tooltip-line]')

  await page.locator('[data-capability-id="1-online-long"]').hover()
  await expect(tooltipLines()).toHaveText([longOnlineName])

  await page.locator('[data-capability-id="1-stale-long"]').hover()
  await expect(tooltipLines()).toHaveText([longStaleName, staleExplanation])

  await page.locator('[data-capability-id="1-stale-short"]').hover()
  await expect(tooltipLines()).toHaveText([staleExplanation])
})

test('keeps broker and capability ordering stable across refresh and search', async ({
  page,
  launcherTour,
}) => {
  const currentTimestamp = new Date().toISOString()
  const discoveredCapability = (
    id: string,
    name: string,
    serviceId: number,
  ) => ({
    id,
    name,
    service_id: serviceId,
    endpoints_schema: { description: `${name} description` },
    last_lifecycle_message: currentTimestamp,
    lifecycle_last_updated: currentTimestamp,
    lifecycle_error: null,
    lifecycle_error_at: null,
  })
  const capabilities = [
    discoveredCapability('z', 'Zulu', 3),
    discoveredCapability('d', 'delta', 2),
    discoveredCapability('a', 'alpha', 1),
    discoveredCapability('b', 'Beta', 2),
    discoveredCapability('A', 'Alpha', 1),
  ]

  launcherTour.setCapabilities(capabilities)
  await page.addInitScript(
    ([key]) => localStorage.setItem(key, '1'),
    [markerKey('launcher-tour-user')],
  )
  await openLauncher(page)

  const browseCapabilities = page.locator('[data-tour="launcher"]')
  const renderedOrder = () =>
    browseCapabilities.locator('[data-broker-group]').evaluateAll((groups) =>
      groups.map((group) => ({
        broker: group.querySelector('h3')?.textContent,
        capabilities: Array.from(
          group.querySelectorAll('[data-capability-id]'),
        ).map((capability) => capability.getAttribute('data-capability-id')),
      })),
    )
  const expectedOrder = [
    {
      broker: 'Alpha Broker',
      capabilities: ['2-b', '2-d'],
    },
    {
      broker: 'Zulu Broker',
      capabilities: ['1-a', '1-A'],
    },
    {
      broker: 'Unknown broker',
      capabilities: ['3-z'],
    },
  ]

  await expect.poll(renderedOrder).toEqual(expectedOrder)

  const requestCount = launcherTour.getCapabilityRequestCount()
  launcherTour.setCapabilities([...capabilities].reverse())
  await launcherTour.emitLifecycleEvent(page)
  await expect
    .poll(() => launcherTour.getCapabilityRequestCount())
    .toBeGreaterThan(requestCount)
  await expect.poll(renderedOrder).toEqual(expectedOrder)

  await browseCapabilities
    .getByPlaceholder('Search capabilities...')
    .fill('delta')
  await expect.poll(renderedOrder).toEqual([
    {
      broker: 'Alpha Broker',
      capabilities: ['2-d'],
    },
  ])
  await expect(
    browseCapabilities.getByText('1 of 5 items installed', { exact: true }),
  ).toBeVisible()
})

test('shows isolated lifecycle errors and refreshes an open profile', async ({
  page,
  launcherTour,
}) => {
  const safeError = 'The lifecycle advertisement could not be parsed.'
  const currentTimestamp = new Date().toISOString()
  const capability = (serviceId: number, lifecycleError: string | null) => ({
    id: serviceId,
    name: 'SharedCapability',
    service_id: serviceId,
    endpoints_schema: { description: `Service ${serviceId} capability` },
    last_lifecycle_message: currentTimestamp,
    lifecycle_last_updated: currentTimestamp,
    lifecycle_error: lifecycleError,
    lifecycle_error_at: lifecycleError ? currentTimestamp : null,
  })

  launcherTour.setCapabilities([capability(1, safeError), capability(2, null)])
  await page.addInitScript(
    ([key]) => localStorage.setItem(key, '1'),
    [markerKey('launcher-tour-user')],
  )
  await openLauncher(page)

  const erroredCapability = page
    .getByRole('button')
    .filter({ hasText: 'SharedCapabilit' })
    .filter({ hasText: 'Error' })
  const healthyCapability = page
    .getByRole('button')
    .filter({ hasText: 'SharedCapabilit' })
    .filter({ hasText: 'Online' })
  await expect(erroredCapability).toBeVisible()
  await expect(healthyCapability).toBeVisible()
  await erroredCapability.hover()
  await expect(
    page.getByRole('tooltip').locator('[data-launcher-tooltip-line]'),
  ).toHaveText(['SharedCapability', safeError])

  await erroredCapability.click()
  await expect(
    page.getByText('Lifecycle health', { exact: true }),
  ).toBeVisible()
  await page.getByRole('img', { name: 'About lifecycle health' }).hover()
  await expect(page.getByRole('tooltip')).toHaveText(
    'Lifecycle message last received/updated is when iHub received or refreshed the message in its database. Capability last processed successfully is the timestamp from the latest capability message that iHub processed successfully. These times may differ; an Error means the latest advertisement could not be processed.',
  )
  await expect(
    page.getByText('Lifecycle message last received/updated', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Capability last processed successfully', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText(safeError, { exact: true })).toBeVisible()
  await expect(page.getByText(/^Occurred:/)).not.toContainText('Unavailable')

  const refreshWarnings: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'warning') {
      refreshWarnings.push(message.text())
    }
  })
  launcherTour.failNextCapabilityRequest()
  await launcherTour.emitLifecycleEvent(page)
  await expect
    .poll(() =>
      refreshWarnings.some((message) =>
        message.includes('Unable to refresh capability details'),
      ),
    )
    .toBe(true)
  await expect(page.getByText(safeError, { exact: true })).toBeVisible()
  await expect(
    page.getByText('Service 1 capability', { exact: true }),
  ).toBeVisible()

  launcherTour.setCapabilities([capability(1, null), capability(2, null)])
  await launcherTour.emitLifecycleEvent(page)
  await expect(page.getByText(safeError, { exact: true })).toBeHidden()
})

test('explains and preserves project selection navigation', async ({
  page,
}) => {
  await openLauncher(page)
  await expectTourStarted(page)

  await page.locator('[data-action="primary"]').click()
  await expect(page.getByRole('alertdialog')).toContainText(
    'Browse capabilities',
  )
  await page.locator('[data-action="primary"]').click()
  await expect(page.getByRole('alertdialog')).toContainText(
    'Return to Projects',
  )
  await expect(page.getByRole('alertdialog')).toContainText(
    'Click iHub to return to the project selection page.',
  )

  await dismissWith(page, 'skip')
  const projectSelectionLink = page.getByRole('link', {
    name: 'iHub',
    exact: true,
  })
  await projectSelectionLink.hover()
  await expect(
    page.getByRole('tooltip', {
      name: 'Return to project selection.',
      exact: true,
    }),
  ).toBeVisible()

  await projectSelectionLink.click()
  await expect(page).toHaveURL(/\/hub\/project\/?$/)
  await expect(page.getByText('Projects', { exact: true })).toBeVisible()
})

test('replay from a document preserves tabs and collapses Account', async ({
  page,
}) => {
  await page.addInitScript(
    ([key]) => localStorage.setItem(key, '1'),
    [markerKey('launcher-tour-user')],
  )
  await page.goto(`/hub/project/${projectId}/notes.txt`)
  await expect(page.getByText('Tour document', { exact: true })).toBeVisible()

  await openAccountPanel(page)
  await takeTour(page)

  await expect(page).toHaveURL(new RegExp(`/hub/project/${projectId}/?$`))
  await expect(page.getByRole('heading', { name: 'Account' })).toBeHidden()
  await expect(page.getByText('notes.txt', { exact: true })).toBeVisible()
  await expect(page.getByText('Launcher', { exact: true })).toBeVisible()
  await expectTourStarted(page)
})

test('waits for delayed launcher targets without target errors or actions', async ({
  page,
  launcherTour,
}) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text())
    }
  })
  launcherTour.deferLauncher()

  const navigation = page.goto(`/hub/project/${projectId}`)
  await expect(
    page.getByText('Restoring your project session...', { exact: true }),
  ).toBeHidden()
  await expect(page.getByRole('alertdialog')).toBeHidden()
  expect(page.url()).toContain(`/hub/project/${projectId}`)
  expect(
    await page
      .locator('[data-active="true"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('aria-label')).filter(Boolean),
      ),
  ).toEqual([])

  launcherTour.resolveLauncher()
  await navigation
  await expectTourStarted(page)
  expect(errors.filter((message) => message.includes('target'))).toEqual([])
})
