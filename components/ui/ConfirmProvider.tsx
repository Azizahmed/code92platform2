'use client';

import {AlertTriangle} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';

import Dialog from '@/components/Dialog';

export type ConfirmOptions = {
  body: string;
  title?: string;
  confirmLabel?: string;
  // Destructive actions get the red button.
  tone?: 'danger' | 'default';
};

type Confirm = (options: ConfirmOptions | string) => Promise<boolean>;

// Outside the provider (tests, an isolated render) fall back to the browser's
// own dialog rather than silently confirming.
const ConfirmContext = createContext<Confirm>(async (options) =>
  window.confirm(typeof options === 'string' ? options : options.body)
);

// An in-app replacement for window.confirm(): it follows the theme and the
// page direction, and does not block the browser's event loop.
export function useConfirm(): Confirm {
  return useContext(ConfirmContext);
}

export default function ConfirmProvider({children}: {children: ReactNode}) {
  const t = useTranslations('ui');
  const [request, setRequest] = useState<
    (ConfirmOptions & {resolve: (value: boolean) => void}) | null
  >(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<Confirm>((options) => {
    const normalized = typeof options === 'string' ? {body: options} : options;
    return new Promise<boolean>((resolve) => {
      setRequest({tone: 'danger', ...normalized, resolve});
    });
  }, []);

  const settle = useCallback(
    (value: boolean) => {
      request?.resolve(value);
      setRequest(null);
    },
    [request]
  );

  useEffect(() => {
    if (request) confirmButton.current?.focus();
  }, [request]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request ? (
        <Dialog title={request.title ?? t('confirm.title')} onClose={() => settle(false)}>
          <div className="flex items-start gap-3">
            {request.tone === 'danger' ? (
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
                <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
              </span>
            ) : null}
            <p className="text-sm leading-relaxed text-muted">{request.body}</p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => settle(false)}
              className="rounded-md border border-hairline px-3.5 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              {t('confirm.cancel')}
            </button>
            <button
              ref={confirmButton}
              type="button"
              onClick={() => settle(true)}
              className={`rounded-md px-3.5 py-2 text-sm font-semibold transition-opacity hover:opacity-90 ${
                request.tone === 'danger' ? 'bg-danger text-white' : 'bg-accent text-bg'
              }`}
            >
              {request.confirmLabel ?? t('confirm.confirm')}
            </button>
          </div>
        </Dialog>
      ) : null}
    </ConfirmContext.Provider>
  );
}
