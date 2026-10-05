// spec: e2e/project-files/specs/project-files.plan.md
// seed: e2e/project-files/seed.spec.ts
import { expect, test } from './fixtures.ts'

test.describe('Project-file browser safety net', () => {
  test('cross-tab-coordination', async ({ context, page, projectFiles }) => {
    const sourcePath = projectFiles.contentPath('lock.txt')
    const targetPath = projectFiles.contentPath('renamed.txt')

    // 1. Hold the editor open in the first tab and attempt rename in the second.
    await projectFiles.row(page, sourcePath).dblclick()
    await expect(page).toHaveURL(
      new RegExp(`/hub/project/${projectFiles.projectId}/lock\\.txt$`),
    )
    await expect(
      page.getByText('shared lock content', { exact: true }),
    ).toBeVisible()

    const secondPage = await context.newPage()
    await projectFiles.openProjectFiles(secondPage)
    const sourceRow = projectFiles.row(secondPage, sourcePath)
    await sourceRow.getByRole('button', { name: 'Rename file' }).click()
    await secondPage
      .getByRole('textbox', { name: 'Rename lock.txt name' })
      .fill('renamed')
    await secondPage.getByRole('button', { name: 'Confirm rename' }).click()
    await expect(
      secondPage.getByText(
        'Close this file in the other browser window or tab before renaming it.',
      ),
    ).toBeVisible()
    expect(
      projectFiles
        .readRequestLog()
        .filter((entry) => entry.operation === 'rename'),
    ).toHaveLength(0)

    // 2. Release the editor, retry, and observe the remote listing refresh.
    await projectFiles.openProjectFiles(page)
    const renameRequest = projectFiles.waitForRequest('rename', {
      logicalPath: sourcePath,
    })
    await secondPage.getByRole('button', { name: 'Confirm rename' }).click()
    await renameRequest
    await expect(projectFiles.row(secondPage, targetPath)).toBeVisible()
    await expect(projectFiles.row(page, targetPath)).toBeVisible()
    await expect(projectFiles.row(page, sourcePath)).toBeHidden()
    expect(
      projectFiles
        .readRequestLog()
        .find(
          (entry) =>
            entry.operation === 'rename' &&
            entry.logicalPath === sourcePath &&
            entry.status === 200,
        ),
    ).toBeDefined()
  })
})
