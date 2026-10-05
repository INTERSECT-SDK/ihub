// spec: e2e/project-files/specs/project-files.plan.md
// seed: e2e/project-files/seed.spec.ts
import { expect, test } from './fixtures.ts'

test.describe('Project-file browser safety net', () => {
  test('encoded-navigation-and-row-action-isolation', async ({
    page,
    projectFiles,
  }) => {
    // 1. Open a nested folder and a filename containing reserved characters.
    await projectFiles
      .row(page, projectFiles.contentPath('nested folder'))
      .dblclick()
    const encodedFile = projectFiles.contentPath(
      'nested folder/literal#%name.txt',
    )
    await projectFiles.row(page, encodedFile).dblclick()
    await expect(page).toHaveURL(
      new RegExp(
        `/hub/project/${projectFiles.projectId}/nested%20folder/literal%23%25name\\.txt$`,
      ),
    )
    await expect(
      page.getByText('encoded path content', { exact: true }),
    ).toBeVisible()

    // 2. Download a different file from its row action.
    await projectFiles.openProjectFiles(page)
    const downloadPath = projectFiles.contentPath('download target.txt')
    const downloadRow = projectFiles.row(page, downloadPath)
    const originalUrl = page.url()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadRow.getByRole('button', { name: 'Download file' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('download target.txt')
    await expect(page).toHaveURL(originalUrl)
    await expect(downloadRow).not.toHaveAttribute('data-active', 'true')
  })
})
