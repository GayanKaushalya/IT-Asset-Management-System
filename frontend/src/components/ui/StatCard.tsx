import type { ReactNode } from 'react';

export type StatAccent = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'security' | 'neutral';

type Props = {
  label: string;
  value: string | number;
  icon?: ReactNode;
  accent?: StatAccent;
  meta?: string;
  delta?: string;
  deltaDir?: 'up' | 'down' | 'flat';
  style?: React.CSSProperties;
};

export default function StatCard({
  label,
  value,
  icon,
  accent = 'primary',
  meta,
  delta,
  deltaDir = 'flat',
  style,
}: Props) {
  return (
    <article className="stat-card" style={style}>
      <div className="stat-card-top">
        <div>
          <p className="stat-card-value">{value}</p>
          <p className="stat-card-label">{label}</p>
        </div>
        {icon ? <div className={`stat-card-icon accent-${accent}`}>{icon}</div> : null}
      </div>
      {(meta || delta) && (
        <p className="stat-card-meta">
          {delta ? <span className={`stat-card-delta ${deltaDir}`}>{delta}</span> : null}
          {delta && meta ? ' · ' : null}
          {meta}
        </p>
      )}
    </article>
  );
}
