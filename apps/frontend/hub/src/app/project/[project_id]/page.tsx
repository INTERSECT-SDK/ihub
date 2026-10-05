import Launcher from '@/components/Launcher'

interface PageProps {
  params: Promise<{
    project_id: string
  }>
}

export default async function Page({ params }: PageProps) {
  const { project_id } = await params
  const projectId = String(project_id ?? '')

  if (!projectId || projectId === 'undefined') {
    return <code>Invalid project path.</code>
  }

  return <Launcher />
}
