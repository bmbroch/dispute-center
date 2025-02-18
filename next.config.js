/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Enable strict type checking
    ignoreBuildErrors: false,
  },
  eslint: {
    // Enable ESLint checking
    ignoreDuringBuilds: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
    ],
  }
};

module.exports = nextConfig;
