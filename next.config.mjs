/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',  // For Google profile images
        port: '',
        pathname: '/a/**',
      },
      {
        protocol: 'https',
        hostname: '**.stripe.com',  // For Stripe-related images
        port: '',
        pathname: '/**',
      }
    ],
  },
  // Strict mode for better development experience
  reactStrictMode: true,
  // Disable x-powered-by header for security
  poweredByHeader: false,
  // Enable static optimization where possible
  swcMinify: true,
  // Configure redirects
  async redirects() {
    return [
      {
        source: '/disputes',
        destination: '/dispute',
        permanent: true,
      },
    ];
  },
  // Configure headers for security
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
