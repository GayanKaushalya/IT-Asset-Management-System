import type { ReactNode } from 'react';

export type BadgeTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'security'
  | 'secured'
  | 'na'
  | 'neutral'
  | 'primary'
  | 'available'
  | 'assigned'
  | 'allocated'
  | 'active'
  | 'inactive'
  | 'pending'
  | 'expired'
  | 'maintenance'
  | 'repair'
  | 'revoked'
  | 'lost'
  | 'retired'
  | 'disposed'
  | 'deployed';

const PRESETS: Record<string, { label: string; tone: BadgeTone }> = {
  available: { label: 'Available', tone: 'available' },
  deployed: { label: 'Assigned', tone: 'assigned' },
  under_repair: { label: 'Under repair', tone: 'maintenance' },
  disposed: { label: 'Disposed', tone: 'retired' },
  active: { label: 'Active', tone: 'active' },
  inactive: { label: 'Inactive', tone: 'inactive' },
  pending: { label: 'Pending', tone: 'pending' },
  expired: { label: 'Expired', tone: 'expired' },
  revoked: { label: 'Revoked', tone: 'revoked' },
  lost: { label: 'Lost / stolen', tone: 'lost' },
  assigned: { label: 'Assigned', tone: 'assigned' },
  allocated: { label: 'Assigned', tone: 'allocated' },
  maintenance: { label: 'Under repair', tone: 'maintenance' },
  retired: { label: 'Disposed', tone: 'retired' },
};

type Props = {
  label?: string;
  tone?: BadgeTone;
  status?: string;
  children?: ReactNode;
  className?: string;
  /** Show status icon inside the pill (Available / Assigned / etc.). */
  withIcon?: boolean;
};

function BadgeIcon({ tone }: { tone: string }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    className: 'status-badge-icon',
  };
  if (tone === 'available') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    );
  }
  if (tone === 'assigned' || tone === 'allocated' || tone === 'deployed') {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M6.5 18.5c.8-2.6 2.9-4 5.5-4s4.7 1.4 5.5 4" />
      </svg>
    );
  }
  if (tone === 'repair' || tone === 'maintenance') {
    return (
      <svg {...common}>
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-3-3 2.5-2.5Z" />
      </svg>
    );
  }
  if (tone === 'lost') {
    return (
      <svg {...common}>
        <path d="m12 4 8.5 15h-17L12 4Z" />
        <path d="M12 10v4.5M12 17.5h.01" />
      </svg>
    );
  }
  if (tone === 'disposed' || tone === 'retired') {
    return (
      <svg {...common}>
        <path d="M4 7h16M9 7V5h6v2M8 7l.8 12h6.4L16 7" />
      </svg>
    );
  }
  return null;
}

export default function StatusBadge({
  label,
  tone,
  status,
  children,
  className = '',
  withIcon = false,
}: Props) {
  const preset = status ? PRESETS[status] : undefined;
  const resolvedLabel = label ?? preset?.label ?? (status ? status.replace(/_/g, ' ') : children);
  const resolvedTone = tone ?? preset?.tone ?? 'neutral';
  const icon = withIcon ? <BadgeIcon tone={resolvedTone} /> : null;

  return (
    <span className={`status-badge tone-${resolvedTone} ${className}`.trim()}>
      {icon}
      {resolvedLabel}
    </span>
  );
}

export function assetStatusTone(status: string | null | undefined, _hasHolder = false): BadgeTone {
  switch (String(status ?? 'available')) {
    case 'deployed':
      return 'assigned';
    case 'under_repair':
      return 'maintenance';
    case 'disposed':
      return 'retired';
    case 'lost':
      return 'lost';
    case 'available':
      return 'available';
    default:
      return 'neutral';
  }
}

export function assetStatusLabel(status: string | null | undefined, _hasHolder = false): string {
  switch (String(status ?? 'available')) {
    case 'deployed':
      return 'Assigned';
    case 'under_repair':
      return 'Under repair';
    case 'disposed':
      return 'Disposed';
    case 'lost':
      return 'Lost / stolen';
    case 'available':
      return 'Available';
    default:
      return String(status ?? 'Unknown').replace(/_/g, ' ');
  }
}
