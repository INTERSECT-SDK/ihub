// spec: e2e/project-files/specs/project-files.plan.md
// seed: e2e/project-files/seed.spec.ts
import { expect, test } from './fixtures.ts'

test('synchronizes capability input sources between canvas and inspector', async ({
  page,
  projectFiles,
}) => {
  const campaignPath = projectFiles.contentPath('source-controls.icmp')
  await projectFiles.row(page, campaignPath).dblclick()
  await expect(page).toHaveURL(/source-controls\.icmp$/)

  await page.getByRole('button', { name: 'Task Group 1', exact: true }).click()

  const targetNode = page.locator(
    '.react-flow__node[data-id="target-capability"]',
  )
  await targetNode.getByRole('button', { name: 'Expand node details' }).click()
  await targetNode.getByText('Target Capability', { exact: true }).click()

  const canvasSource = targetNode.getByRole('radiogroup', {
    name: 'Input source for Message',
  })
  const inspectorSource = page
    .getByRole('complementary', { name: 'Task inspector' })
    .getByRole('radiogroup', { name: 'Input source for Message' })

  await expect(
    canvasSource.getByRole('radio', { name: 'Upstream' }),
  ).toBeChecked()
  await expect(
    inspectorSource.getByRole('radio', { name: 'Upstream' }),
  ).toBeChecked()

  await canvasSource.getByText('Custom', { exact: true }).click()
  await expect(
    inspectorSource.getByRole('radio', { name: 'Custom' }),
  ).toBeChecked()

  await inspectorSource.getByText('Upstream', { exact: true }).click()
  await expect(
    canvasSource.getByRole('radio', { name: 'Upstream' }),
  ).toBeChecked()

  const upstreamValue = page
    .getByRole('complementary', { name: 'Task inspector' })
    .getByRole('textbox', { name: 'Upstream value for Message' })
  await upstreamValue.click()
  await page.getByRole('option', { name: 'Result (string)' }).click()

  const mappingSave = await projectFiles.waitForRequest('save', {
    logicalPath: campaignPath,
  })
  await expect
    .poll(() => projectFiles.readPersistedContent('source-controls.icmp'))
    .toMatchObject({
      task_groups: [
        {
          ui_edges: [
            {
              data: {
                data_mapping: [
                  {
                    source_parameter: 'result',
                    target_parameter: 'message',
                  },
                ],
              },
            },
          ],
        },
      ],
    })

  await canvasSource.getByText('Custom', { exact: true }).click()
  const customValue = page
    .getByRole('complementary', { name: 'Task inspector' })
    .getByRole('textbox', { name: 'Custom value for Message' })
  await customValue.fill('shared custom value')
  await page.getByRole('button', { name: 'Open Launcher tab' }).click()
  await projectFiles.waitForRequest('save', {
    afterOrder: mappingSave.order,
    logicalPath: campaignPath,
  })
  await expect(page).toHaveURL(
    new RegExp(`/hub/project/${projectFiles.projectId}$`),
  )
  expect(
    projectFiles.readPersistedContent('source-controls.icmp'),
  ).toMatchObject({
    task_groups: [
      {
        tasks: [
          {},
          { manual_input_values: { message: 'shared custom value' } },
        ],
        ui_edges: [{ data: { data_mapping: [] } }],
      },
    ],
  })
})
