const ICONS = {
  graph: {
    bg: '#16A384',
    path: 'M4 19V10M10 19V5M16 19v-7M20 19H3',
  },
  vente: {
    bg: '#FF7000',
    path: 'M6 6h15l-1.5 9h-12L6 6zm0 0L5 3H2m5 16a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm11 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z',
  },
  stock: {
    bg: '#173873',
    path: 'M21 8l-9 4-9-4 9-4 9 4zm0 0v8l-9 4-9-4V8',
  },
  produit: {
    bg: '#7C3AED',
    path: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zm0 0v18M4 7.5l8 4.5 8-4.5',
  },
  rapport: {
    bg: '#7C3AED',
    path: 'M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zm7 0v5h5M8 13h8M8 17h5',
  },
  client: {
    bg: '#EAB308',
    path: 'M16 19v-1a4 4 0 00-4-4H8a4 4 0 00-4 4v1m12-10a3 3 0 10-6 0 3 3 0 006 0zm6 10v-1a3.5 3.5 0 00-2.5-3.35M16.5 7.2a3 3 0 010 5.6',
  },
  dette: {
    bg: '#D64545',
    path: 'M8 10a4 4 0 108 0 4 4 0 00-8 0zm-3 8a6.5 6.5 0 0114 0M12 6v8',
  },
  shield: {
    bg: '#173873',
    path: 'M12 3l8 4v6c0 5-3.4 7.6-8 9-4.6-1.4-8-4-8-9V7l8-4z',
  },
  chat: {
    bg: '#FF7000',
    path: 'M5 16l-2 4 5-2h9a4 4 0 004-4V8a4 4 0 00-4-4H8a4 4 0 00-4 4v8z',
  },
};

export default function BrandIcon({ name, size = 36, className = '' }) {
  const icon = ICONS[name];
  if (!icon) return null;
  const mark = Math.round(size * 0.5);
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-[10px] ${className}`}
      style={{ width: size, height: size, backgroundColor: icon.bg }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width={mark} height={mark} fill="none">
        <path d={icon.path} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
