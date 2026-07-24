# Code 92 Command Center — Design System

Internal "mission control" console for Code 92's AI product team. Refined, dark,
data-dense, precise. **Not** a marketing page — restraint over flash.

## Theme

Dark and light modes are available from the sidebar preference controls. The
saved choice is restored before the app renders; otherwise the operating-system
preference is used.

| Token      | Value                     | Tailwind class  | Usage                                   |
| ---------- | ------------------------- | --------------- | --------------------------------------- |
| Background | `#0B0E13`                 | `bg-bg`         | App background                          |
| Panel      | `#11151C`                 | `bg-panel`      | Cards, sidebar, forms                   |
| Raised     | `#161C26`                 | `bg-raised`     | Hover states, chips, inset elements     |
| Hairline   | `rgba(255,255,255,0.07)`  | `border-hairline` | All borders, always 1px               |
| Accent     | `#34D399` (phosphor green)| `bg/text/border-accent` | Primary actions, healthy status, active nav |
| Amber      | `#FBBF24`                 | `bg/text/border-amber`  | Warning / overdue / at-risk         |
| Danger     | `#F87171`                 | `bg/text/border-danger` | Critical, destructive, errors       |
| Ink        | `#E6EAF2`                 | `text-ink`      | Primary text                            |
| Muted      | `#8B95A7`                 | `text-muted`    | Secondary text                          |
| Faint      | `#5B6577`                 | `text-faint`    | Placeholders, captions, disabled        |

Rules:

- Status colors (accent green / amber / danger red) are the **only** saturated
  hues in the UI. Everything else is neutral.
- Status tints use ~10% background + 30% border (e.g. `bg-amber/10 border-amber/30`).
- Primary button: `bg-accent text-bg font-semibold`.
- Borders are always `border border-hairline` (1px). No shadows except the
  small status-dot glow in `HealthBadge`.

## Responsive shell

- Desktop (`md` and above): fixed logical-start sidebar, `w-60`.
- Mobile: compact sticky header plus a fixed bottom icon navigation bar.
- Language, appearance, account identity, and sign-out live in the mobile
  preferences sheet opened from the header.
- Main content uses phone-safe padding and reserves space for the bottom bar,
  including `safe-area-inset-bottom` on notched devices.

## Atmosphere

Defined once in `app/globals.css` on `body`: a faint 32px engineering grid
plus a soft phosphor radial glow from the top edge. Do not add more texture
per page.

## Typography

Loaded via `next/font/google` in `app/[locale]/layout.tsx` as CSS variables:

- `--font-plex-sans` — IBM Plex Sans, EN body/UI text (`font-sans`, default).
- `--font-plex-arabic` — IBM Plex Sans Arabic, takes over body text
  automatically when `dir="rtl"` (see `globals.css`). Use `font-arabic` only
  for one-off overrides.
- `--font-plex-mono` — IBM Plex Mono (`font-mono`) for **numbers, timestamps,
  slugs, IDs, counts**. Labels and prose stay in the sans face.

Scale (convention): page title `text-xl font-semibold`, section title
`text-sm font-medium`, body `text-sm`, captions/labels `text-xs text-muted`,
micro-labels (nav sections, chips) `text-[10-11px] uppercase tracking-widest text-faint`.

## RTL — hard rules

- The **single** RTL switch is `<html dir>` in `app/[locale]/layout.tsx`
  (`rtl` for `ar`, `ltr` for `en`). Never set `dir` anywhere else.
- **Logical Tailwind utilities only**: `ms/me`, `ps/pe`, `start-0`, `end-0`,
  `text-start`, `border-s`/`border-e`. Physical `ml/mr/pl/pr/left/right/
  border-l/border-r/text-left/text-right` are banned (audited in M7).
- Directional icons (chevrons, arrows pointing along text flow) get
  `rtl:rotate-180`. Status/brand icons are not mirrored.
- Latinate data (emails, URLs, slugs) keeps `dir="ltr"` even in Arabic UI.

## i18n

- Locales `en` (default) + `ar`, locale-prefixed routes via `next-intl`.
- Messages are **split by namespace**: `messages/<locale>/<namespace>.json`,
  deep-merged in `i18n/request.ts`. To add a namespace: create the file for
  **both** locales and append its name to `NAMESPACES` in `i18n/request.ts`.
  Never edit another workstream's namespace file — that's how we avoid merge
  conflicts.
- Every user-visible string comes from a message file. No hardcoded copy.
- Use `Link`/`redirect`/`useRouter` from `i18n/navigation` (never `next/link`
  directly) so the locale prefix is preserved.

## Components (components/)

| Component            | Notes                                                        |
| -------------------- | ------------------------------------------------------------ |
| `AppShell`           | Sidebar nav + user card + sign out. Bare chrome on `/login`. Admin nav item only for active admins. |
| `LocaleSwitcher`     | Segmented EN/عربي control, keeps current path.               |
| `HealthBadge`        | Status dot (with subtle glow) + localized label.             |
| `StageChip`          | Mono uppercase chip for product stage.                       |
| `OverdueBadge`       | Amber badge for overdue reviews.                             |
| `RelativeTime`       | Client component, `Intl.RelativeTimeFormat` in active locale, mono font, absolute time in `title`. |
| `PlaceholderSection` | Temporary "coming soon" panel for later-milestone routes.    |

Conventions:

- Density: sidebar `w-60`, main content `px-8 py-8`, nav items `py-2 text-sm`.
- Panels: `rounded-lg border border-hairline bg-panel`; empty states use
  `border-dashed` + centered icon in a tinted circle.
- Icons: `lucide-react`, `strokeWidth={1.75}` (1.5–2 range), sized `h-4 w-4`
  inline / `h-5 w-5` featured.

## Auth UX

- `/login` is sign-in and request-access (sign-up) in one card with a toggle.
- Sign-up creates the auth user **and** a pending `team_members` row
  (`is_active=false`) in one Server Action, then the page shows the
  "awaiting approval" state. Signed-in-but-inactive users see the same state.
- Data access is enforced by Postgres RLS; the UI gate (`requireActiveMember`
  in `lib/auth.ts`) is only for navigation.
