import type {MetadataRoute} from 'next';

import {THEME_COLORS} from '@/lib/theme-colors';

// Served at /manifest.webmanifest; Next links it from every page's <head>.
// The manifest has no locale: "/" goes through the locale middleware like any
// other unprefixed visit, and the shortcuts use the default locale.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Code 92 Command Center',
    short_name: 'Code 92',
    description: 'Mission control for the Code 92 AI product team.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0B0E13',
    theme_color: THEME_COLORS.dark,
    categories: ['productivity', 'business'],
    icons: [
      {src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any'},
      {src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any'},
      {src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable'},
      {src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'}
    ],
    shortcuts: [
      {name: 'My work', url: '/en/my-work', icons: [{src: '/icons/icon-192.png', sizes: '192x192'}]},
      {name: 'All tasks', url: '/en/tasks', icons: [{src: '/icons/icon-192.png', sizes: '192x192'}]},
      {name: 'Channels', url: '/en/channels', icons: [{src: '/icons/icon-192.png', sizes: '192x192'}]}
    ]
  };
}
