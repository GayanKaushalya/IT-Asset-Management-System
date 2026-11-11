type AssetKind = 'laptop' | 'mobile_phone' | 'pc' | 'printer' | 'other' | string;

type Props = {
  type: AssetKind;
  className?: string;
};

/** Icons match the Indra inventory set: tab (teal) + laptop (blue). */
export default function AssetIcon({ type, className = '' }: Props) {
  const kind = normalize(type);
  return (
    <span className={`asset-type-icon ${kind} ${className}`.trim()} aria-hidden>
      {iconFor(kind)}
    </span>
  );
}

function normalize(type: string): string {
  const t = type.toLowerCase();
  if (t === 'mobile-phones' || t === 'mobile' || t === 'phone' || t === 'tab' || t === 'tablet') {
    return 'mobile_phone';
  }
  if (t === 'others') return 'other';
  return t;
}

function iconFor(kind: string) {
  switch (kind) {
    case 'laptop':
      // Screen + base (matches provided laptop icon)
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="5" width="16" height="11" rx="1.5" />
          <path d="M2.5 18.5h19" />
        </svg>
      );
    case 'mobile_phone':
      // Vertical phone / tab with speaker + home button (matches provided icon)
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="2.5" width="10" height="19" rx="2.25" />
          <path d="M10.5 5.25h3" />
          <circle cx="12" cy="18.25" r="0.85" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'pc':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
    case 'printer':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 9V3h12v6" />
          <rect x="4" y="9" width="16" height="8" rx="1.5" />
          <path d="M6 17h12v4H6z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M9 9h6M9 12h6M9 15h4" />
        </svg>
      );
  }
}
