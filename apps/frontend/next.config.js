/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Docker standalone build
  output: 'standalone',

  // Allow mediasoup-client to be bundled (it uses some Node.js APIs)
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // mediasoup-client needs these resolved as empty on the client
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs:   false,
        net:  false,
        tls:  false,
        dgram: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;