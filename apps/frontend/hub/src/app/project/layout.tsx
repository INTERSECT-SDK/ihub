import ProjectBootstrapBoundary from './ProjectBootstrapBoundary.tsx'

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ProjectBootstrapBoundary>{children}</ProjectBootstrapBoundary>
}
