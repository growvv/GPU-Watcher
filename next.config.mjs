/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Force wasm-based SWC to avoid native binary compatibility issues
    useWasmBinary: true,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      if (typeof config.externals === 'function') {
        const original = config.externals;
        config.externals = (context, request, callback) => {
          if (request === 'ssh2') {
            return callback(null, 'commonjs ssh2');
          }
          return original(context, request, callback);
        };
      } else {
        config.externals = config.externals || [];
        config.externals.push({
          ssh2: 'commonjs ssh2',
        });
      }
    }

    return config;
  },
};

export default nextConfig;
