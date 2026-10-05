import ClientPage from './ClientPage'
import { getLogicalFilePath } from '../../project-file-path'

interface PageProps {
  params: Promise<{
    project_id: string
    file_path?: string | string[]
  }>
}

export default async function Page({ params }: PageProps) {
  const { project_id, file_path } = await params
  const normalizedFilePath = Array.isArray(file_path)
    ? getLogicalFilePath(file_path)
    : file_path
      ? getLogicalFilePath([file_path])
      : file_path
  const projectId = String(project_id ?? '')
  const filePath = String(normalizedFilePath ?? '')

  if (!projectId || !filePath) {
    return <code>Invalid file path.</code>
  }

  return <ClientPage project_id={projectId} file_path={filePath} />
}
