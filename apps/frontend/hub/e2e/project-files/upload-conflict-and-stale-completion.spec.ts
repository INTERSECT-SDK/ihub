// spec: e2e/project-files/specs/project-files.plan.md
// seed: e2e/project-files/seed.spec.ts
import { expect, test } from './fixtures.ts'

test.describe('Project-file browser safety net', () => {
  test('upload-conflict-and-stale-completion', async ({
    page,
    projectFiles,
  }) => {
    const uploadInput = page.locator('input[type="file"]')
    const uploadButton = page.getByRole('button', { name: 'Upload file' })

    // 1. Upload a file whose name already exists.
    await expect(uploadButton).toBeEnabled()
    await uploadInput.setInputFiles({
      name: 'existing.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('replacement content'),
    })
    await expect(page.getByText('Replace existing existing.txt?')).toBeVisible()

    // 2. Confirm the overwrite.
    const overwriteRequest = projectFiles.waitForRequest('upload', {
      afterOrder: Math.max(
        ...projectFiles.readRequestLog().map((entry) => entry.order),
      ),
      logicalPath: projectFiles.contentPath('existing.txt'),
    })
    await page.getByRole('button', { name: 'Overwrite' }).click()
    await overwriteRequest
    await expect(page.getByText('existing.txt uploaded.')).toBeVisible()
    expect(
      projectFiles
        .readRequestLog()
        .find(
          (entry) =>
            entry.operation === 'upload' &&
            entry.logicalPath === projectFiles.contentPath('existing.txt') &&
            entry.status === 200,
        ),
    ).toBeDefined()

    // 3. Start another upload and navigate away before it finishes.
    const deferredUpload = projectFiles.deferNext('upload')
    await expect(uploadButton).toBeEnabled()
    await uploadInput.setInputFiles({
      name: 'late.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('late content'),
    })
    const latePath = projectFiles.contentPath('late.txt')
    await projectFiles.waitForRequest('upload', { logicalPath: latePath })
    await projectFiles.row(page, projectFiles.contentPath('archive')).dblclick()
    await expect(page.getByText('archive', { exact: true })).toBeVisible()

    const uploadResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/contents/save/') &&
        response.request().method() === 'PUT' &&
        response.status() === 200,
    )
    projectFiles.resolveDeferred(deferredUpload)
    await uploadResponse
    await expect(page.getByText('late.txt uploaded.')).toBeHidden()
    await expect(projectFiles.row(page, latePath)).toBeHidden()
  })
})
