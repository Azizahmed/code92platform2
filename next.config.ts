import type {NextConfig} from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  // A parent lockfile must not make Turbopack scan the whole host workspace.
  turbopack: {root: __dirname},
  // Keep the serverless PDF.js build out of the client and bundler transforms.
  serverExternalPackages: ['unpdf']
};

export default withNextIntl(nextConfig);
