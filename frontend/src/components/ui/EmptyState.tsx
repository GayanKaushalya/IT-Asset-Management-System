import type { ReactNode } from 'react';

type EmptyProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ title, description, icon, action }: EmptyProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden>
        {icon ?? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 9h18" />
          </svg>
        )}
      </div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div style={{ marginTop: '0.65rem' }}>{action}</div> : null}
    </div>
  );
}

type ErrorProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
};

export function ErrorState({
  title = 'Unable to load data',
  description = 'Something went wrong while retrieving the information.',
  onRetry,
}: ErrorProps) {
  return (
    <div className="error-state">
      <div className="error-state-icon" aria-hidden>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5" />
          <path d="M12 16h.01" />
        </svg>
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {onRetry ? (
        <button type="button" className="btn btn-primary" style={{ marginTop: '0.65rem' }} onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

type SkeletonProps = {
  rows?: number;
  cards?: number;
};

export function LoadingSkeleton({ rows = 0, cards = 0 }: SkeletonProps) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {cards > 0 ? (
        <div className="stat-grid" style={{ marginBottom: '1rem' }}>
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : null}
      {rows > 0
        ? Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="skeleton skeleton-line" style={{ width: `${85 - (i % 3) * 10}%` }} />
          ))
        : null}
    </div>
  );
}
