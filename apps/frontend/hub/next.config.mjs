/** @type {import('next').NextConfig} */
import pkg from '@next/env'
const { loadEnvConfig } = pkg
const projectDir = process.cwd()
loadEnvConfig(projectDir)

const nextConfig = {
  // ...other configuration
  transpilePackages: ['@ihub/ui', '@ihub/utils'],
  output: 'standalone',
  reactStrictMode: true,
  basePath: '/hub',
  allowedDevOrigins: ['127.0.0.1'],
  experimental: {},
  // WARNING: we should remove this when ready for production
  // eslint: {
  //   ignoreDuringBuilds: true,
  // },
  // WARNING: we should remove this when ready for production
  typescript: {
    ignoreBuildErrors: true,
  },
}

export default nextConfig
