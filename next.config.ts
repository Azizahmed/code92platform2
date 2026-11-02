import type {NextConfig} from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  // A parent lockfile must not make Turbopack scan the whole host workspace.
  turbopack: {root: __dirname},
  // Keep the serverless PDF.js build out of the client and bundler transforms.
  serverExternalPackages: ['unpdf'],
  async headers() {
    return [
      {
        // The worker must always be revalidated, or clients keep an old one.
        source: '/sw.js',
        headers: [
          {key: 'Content-Type', value: 'application/javascript; charset=utf-8'},
          {key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate'},
          {key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'"}
        ]
      }
    ];
  }
};

export default withNextIntl(nextConfig);
