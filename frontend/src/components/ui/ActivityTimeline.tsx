import type { ReactNode } from 'react';

type ActivityItem = {
  id: string;
  title: string;
  description?: string;
  user?: string;
  time: string;
  tone?: 'primary' | 'security' | 'success' | 'warning';
  icon?: ReactNode;
};

type Props = {
  items: ActivityItem[];
  emptyMessage?: string;
};

export default function ActivityTimeline({ items, emptyMessage = 'No recent activity yet.' }: Props) {
  if (items.length === 0) {
    return <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>{emptyMessage}</p>;
  }

  return (
    <div className="activity-list">
      {items.map((item) => (
        <div key={item.id} className="activity-item">
          <div className={`activity-icon ${item.tone ?? 'primary'}`} aria-hidden>
            {item.icon ?? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4l2.5 2.5" />
              </svg>
            )}
          </div>
          <div className="activity-body">
            <strong>{item.title}</strong>
            {item.description ? <span>{item.description}</span> : null}
            {item.user ? <span>{item.user}</span> : null}
          </div>
          <time className="activity-time">{item.time}</time>
        </div>
      ))}
    </div>
  );
}
