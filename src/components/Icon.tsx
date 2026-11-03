// Thin-stroke icons (24×24, currentColor) for the sidebar and quick actions.
const PATHS = {
  plus: <path d="M12 5v14M5 12h14" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="7" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="12" cy="17.5" r="2.2" />
      <path d="M7.8 8.2l3 7.3M16.3 7.6l-3 8M8.2 7h7.6" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z" />
      <path d="M5 17a3 3 0 0 1 3-3h10" />
    </>
  ),
  pencil: <path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19zM14.5 6.5l3 3" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" />
    </>
  ),
  cards: (
    <>
      <rect x="3.5" y="7" width="13" height="12" rx="2" />
      <path d="M7.5 7V5.5a2 2 0 0 1 2-2H18a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2h-1.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  code: <path d="M8.5 7L4 12l4.5 5M15.5 7l4.5 5-4.5 5M13.5 5l-3 14" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.3 3.8 8.5S14.6 18.1 12 20.5C9.4 18.1 8.2 15.2 8.2 12S9.4 5.9 12 3.5z" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.5 1.5M16.5 16.5L18 18M18 6l-1.5 1.5M7.5 16.5L6 18" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  sparkle: <path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />,
  flame: <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.6 3.9-8.3.4 1.9 1.4 3.1 2.6 3.6.1-2.8 1.3-5.3 3.4-7.1-.1 2.9 1.1 4.6 2.2 6.2 1 1.5 1.9 3 1.9 5.4 0 3.8-3.2 6.4-7.5 6.4zM12 21c-1.6 0-2.8-1.2-2.8-2.8 0-1.7 1.4-2.6 2.2-4 .9 1.5 3.4 2.4 3.4 4.2 0 1.5-1.2 2.6-2.8 2.6z" />,
  heart: <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />,
  spark: <path d="M4 18l5-6 4 3 7-9M15 6h5v5" />,
  cap: <path d="M3 9l9-4 9 4-9 4-9-4zM7 11.3V15c0 1.5 2.2 3 5 3s5-1.5 5-3v-3.7M21 9v5" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </>
  ),
  half: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {PATHS[name]}
    </svg>
  );
}
