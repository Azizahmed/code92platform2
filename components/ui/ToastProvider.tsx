'use client';

import {CheckCircle2, Info, X, XCircle} from 'lucide-react';
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

export type ToastAction = {label: string; onClick: () => void};

export type ToastOptions = {
  message: string;
  tone?: 'success' | 'info' | 'error';
  actions?: ToastAction[];
  // Milliseconds; toasts with an action stay a little longer by default.
  duration?: number;
};

type Toast = ToastOptions & {id: number};

type ShowToast = (options: ToastOptions) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

const ICONS = {success: CheckCircle2, info: Info, error: XCircle} as const;
const ICON_TONE = {success: 'text-accent', info: 'text-muted', error: 'text-danger'} as const;

function ToastItem({toast, onDismiss}: {toast: Toast; onDismiss: (id: number) => void}) {
  const t = useTranslations('ui');
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration ?? (toast.actions?.length ? 7000 : 4000));
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, onDismiss, toast.id]);

  const tone = toast.tone ?? 'success';
  const Icon = ICONS[tone];

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="toast-enter pointer-events-auto flex w-full items-center gap-3 rounded-lg border border-hairline bg-panel px-3.5 py-2.5 text-sm shadow-2xl sm:w-auto sm:min-w-[320px] sm:max-w-md"
    >
      <Icon className={`h-4 w-4 shrink-0 ${ICON_TONE[tone]}`} strokeWidth={1.75} />
      <span className="min-w-0 flex-1 text-ink">{toast.message}</span>
      {toast.actions?.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => {
            action.onClick();
            onDismiss(toast.id);
          }}
          className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/10"
        >
          {action.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={t('toast.dismiss')}
        className="shrink-0 rounded p-1 text-faint transition-colors hover:bg-raised hover:text-ink"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

// Short confirmations with an optional action (Undo, Open, Add a note). They
// sit above the mobile tab bar and stack, newest last; at most three show.
export default function ToastProvider({children}: {children: ReactNode}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const show = useCallback<ShowToast>((options) => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-2), {...options, id}]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[80] flex flex-col items-center gap-2 md:bottom-6"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
