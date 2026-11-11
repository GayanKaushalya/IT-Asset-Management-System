import type { ReactNode } from 'react';

type Props = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  eyebrow?: string;
  /** Optional status pill next to the title (e.g. Live Repository). */
  badge?: ReactNode;
};

export default function PageHeader({ title, subtitle, actions, eyebrow, badge }: Props) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {eyebrow ? (
          <p className="eyebrow" style={{ margin: 0, color: 'var(--primary)', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {eyebrow}
          </p>
        ) : null}
        <div className="page-header-title-row">
          <div className="page-header-title-group">
            <h1 className="page-title" style={{ marginBottom: 0 }}>{title}</h1>
            {badge ? <span className="page-header-badge">{badge}</span> : null}
          </div>
          {actions ? <div className="page-header-actions">{actions}</div> : null}
        </div>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      <style>{`
        .page-header-title-group {
          display: inline-flex;
          align-items: center;
          gap: 0.55rem;
          flex-wrap: wrap;
          min-width: 0;
        }
        .page-header-badge {
          display: inline-flex;
          align-items: center;
        }
        .live-repo-badge {
          display: inline-flex;
          align-items: center;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #166534;
          background: #dcfce7;
          border: 1px solid #86efac;
          border-radius: 999px;
          padding: 0.18rem 0.55rem;
          line-height: 1.2;
          white-space: nowrap;
        }
      `}</style>
    </header>
  );
}

/** Shared pill used on report pages. */
export function LiveRepositoryBadge() {
  return <span className="live-repo-badge">Live Repository</span>;
}
