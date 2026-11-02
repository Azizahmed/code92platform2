'use client';

import {useEffect} from 'react';

// Registers public/sw.js in production builds only: in `next dev` the worker
// would cache Turbopack chunks across HMR updates.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) {
      return;
    }
    navigator.serviceWorker
      .register('/sw.js', {scope: '/', updateViaCache: 'none'})
      .catch((error) => console.error('Service worker registration failed', error));
  }, []);

  return null;
}
