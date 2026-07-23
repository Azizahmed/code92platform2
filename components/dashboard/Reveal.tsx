'use client';

import {useEffect, useState} from 'react';

type Props = {
  index?: number;
  className?: string;
  children: React.ReactNode;
};

// Staggered on-load reveal: fades/slides children in with a per-item delay.
// Pure CSS transition triggered after mount — no keyframes needed.
export default function Reveal({index = 0, className = '', children}: Props) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={`${className} transition-all duration-500 ease-out ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
      style={{transitionDelay: `${Math.min(index, 12) * 60}ms`}}
    >
      {children}
    </div>
  );
}
