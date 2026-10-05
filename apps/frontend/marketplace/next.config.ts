/** @type {import('next').NextConfig} */

const nextConfig = {
  // ...other configuration
  transpilePackages: ["@repo/ui"],
  output: "standalone",
  assetPrefix: "/",
  experimental: {
    optimizePackageImports: ["@mantine/core", "@mantine/hooks"],
  },
  // WARNING: we should remove this when ready for production
  // eslint: {
  //   ignoreDuringBuilds: true,
  // },
  // WARNING: we should remove this when ready for production
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
