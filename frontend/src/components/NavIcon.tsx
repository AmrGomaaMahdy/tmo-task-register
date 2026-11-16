/** Line icons of the side menu, one per page. */
const PATHS: Record<string, string[]> = {
  '/': ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  '/register': ['M9 6h11M9 12h11M9 18h11', 'M4.5 6h.01M4.5 12h.01M4.5 18h.01'],
  '/activities': ['M4 6l1.6 1.6L8.5 4.7M4 12.5l1.6 1.6 2.9-2.9M4 19l1.6 1.6 2.9-2.9', 'M12 6.5h8M12 13h8M12 19.5h5'],
  '/links': ['M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.3 1.3', 'M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.3-1.3'],
  '/check': ['M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z', 'M8.6 12.2l2.4 2.4 4.6-4.8'],
  '/master-plan': ['M3 5h18M3 5v15h18', 'M6.5 8h7v2.6h-7zM10 12.2h8v2.6h-8zM8 16.4h5v2.6H8z'],
  '/configuration': ['M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z', 'M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5'],
  '/backup': ['M4.5 5.5c0-1.5 3.4-2.8 7.5-2.8s7.5 1.3 7.5 2.8-3.4 2.8-7.5 2.8-7.5-1.3-7.5-2.8z', 'M4.5 5.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6M4.5 11.5v6c0 1.5 3.4 2.8 7.5 2.8 1 0 2-.1 2.9-.2', 'M18 15.5v6M15.5 19l2.5 2.5 2.5-2.5'],
};

export default function NavIcon({ to }: { to: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(PATHS[to] ?? []).map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
