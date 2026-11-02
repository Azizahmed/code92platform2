import {initials} from '@/lib/task-ui';

// A neutral initials badge. Identity is the name beside it or in the tooltip,
// never the colour, so every avatar shares one quiet style.
export default function Avatar({
  name,
  size = 'sm',
  title
}: {
  name: string | null | undefined;
  size?: 'xs' | 'sm' | 'md';
  title?: string;
}) {
  const sizes = {xs: 'h-5 w-5 text-[9px]', sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-xs'} as const;
  return (
    <span
      title={title ?? name ?? undefined}
      aria-hidden={title || name ? undefined : true}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border font-medium ${sizes[size]} ${
        name ? 'border-hairline bg-raised text-muted' : 'border-dashed border-hairline text-faint'
      }`}
    >
      {name ? initials(name) : '–'}
    </span>
  );
}
