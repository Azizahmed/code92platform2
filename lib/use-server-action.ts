'use client';

import {useCallback, useState} from 'react';

import {guardNavigation, REDIRECT_COMMIT_MS, redirectTarget} from '@/lib/navigation-guard';

// Runs a server action with a plain pending flag instead of an async
// startTransition. Inside an async transition the action is entangled with
// the router's own transition (React 19 / Next 15), and the revalidated tree
// in the action response was measurably more likely to be left uncommitted,
// with the pending state sometimes never clearing.
export function useServerAction(): [boolean, <T>(action: () => Promise<T>) => Promise<T>] {
  const [pending, setPending] = useState(false);
  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    setPending(true);
    try {
      return await action();
    } catch (error) {
      const url = redirectTarget(error);
      // A redirect lands through Next; the guard covers the stall.
      if (url) guardNavigation(url, REDIRECT_COMMIT_MS);
      throw error;
    } finally {
      setPending(false);
    }
  }, []);
  return [pending, run];
}
