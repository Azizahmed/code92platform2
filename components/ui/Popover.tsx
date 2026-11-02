'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react';
import {createPortal} from 'react-dom';

// A floating panel anchored to a trigger. Portalled to <body> with fixed
// positioning so list containers with overflow-hidden cannot clip it (the same
// fix the notification bell needed). Opens below the trigger aligned to its
// inline-end edge, flips above when there is no room, and closes on an outside
// press, Escape, scroll of the page or a resize.
export default function Popover({
  anchorRef,
  open,
  onClose,
  children,
  width = 220,
  align = 'end',
  label
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: 'start' | 'end';
  label?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{top: number; left: number} | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    const panelHeight = panel?.offsetHeight ?? 0;
    const gap = 6;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const panelWidth = Math.min(width, viewportWidth - 16);

    // Inline-end in LTR is the right edge; in RTL it is the left one.
    const alignToRight = (align === 'end') !== rtl;
    let left = alignToRight ? rect.right - panelWidth : rect.left;
    left = Math.max(8, Math.min(left, viewportWidth - panelWidth - 8));

    let top = rect.bottom + gap;
    if (top + panelHeight > viewportHeight - 8 && rect.top - gap - panelHeight > 8) {
      top = rect.top - gap - panelHeight;
    }
    setPosition({top, left});
  }, [anchorRef, align, width]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    place();
    // A second pass once the panel has measured itself, for the flip.
    const frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        anchorRef.current?.focus();
      }
    };
    const onViewportChange = (event: Event) => {
      // Scrolling inside the panel itself is fine.
      if (event.type === 'scroll' && panelRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      style={{
        position: 'fixed',
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width: Math.min(width, typeof window === 'undefined' ? width : window.innerWidth - 16)
      }}
      className="z-[70] rounded-lg border border-hairline bg-panel p-1 shadow-2xl"
    >
      {children}
    </div>,
    document.body
  );
}
