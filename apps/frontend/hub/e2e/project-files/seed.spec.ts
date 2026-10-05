// spec: e2e/project-files/specs/project-files.plan.md
// seed: e2e/project-files/seed.spec.ts
import { expect, test } from './fixtures.ts'

test.describe('Project-file browser safety net', () => {
  test('bootstrap-and-open-project-files', async ({ page, projectFiles }) => {
    // 1. Open the test project with a synthetic authenticated session.
    const sessionRequest = await projectFiles.waitForRequest('session')
    const serverRequest = await projectFiles.waitForRequest('jupyter-server')
    const tokenRequest = await projectFiles.waitForRequest('jupyter-token')
    expect(sessionRequest.status).toBe(200)
    expect(serverRequest.status).toBe(200)
    expect(tokenRequest.status).toBe(200)
    await expect(
      page.getByText('Restoring your project session...', { exact: true }),
    ).toBeHidden()

    // 2. Open Project Files from the navigation rail.
    await expect(page).toHaveURL(
      new RegExp(`/hub/project/${projectFiles.projectId}$`),
    )
    await expect(
      page.getByRole('table', { name: 'Project files' }),
    ).toBeVisible()
    await expect(
      projectFiles.row(page, projectFiles.contentPath('existing.txt')),
    ).toBeVisible()
  })
})
