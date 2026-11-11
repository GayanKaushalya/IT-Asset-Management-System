import { useEffect, useState } from 'react';
import { api } from '../services/client';

export type LifecycleEvent = {
  id: string;
  type: string;
  tone?: 'success' | 'info' | 'primary' | 'warning' | 'danger' | 'neutral';
  title: string;
  detail: string;
  at?: string | null;
  date?: string | null;
};

type Props = {
  category: string;
  assetId: number;
  /** Bump to reload after kit/handover changes */
  refreshKey?: number;
};

function toneClass(tone?: string): string {
  switch (tone) {
    case 'success':
      return 'lc-dot--success';
    case 'info':
      return 'lc-dot--info';
    case 'primary':
      return 'lc-dot--primary';
    case 'warning':
      return 'lc-dot--warning';
    case 'danger':
      return 'lc-dot--danger';
    default:
      return 'lc-dot--neutral';
  }
}

export default function AssetLifecycleTimeline({ category, assetId, refreshKey = 0 }: Props) {
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await api<{ data: LifecycleEvent[] }>(
          `/api/assets/${category}/${assetId}/lifecycle`,
        );
        if (!cancelled) setEvents(res.data ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load lifecycle');
          setEvents([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [category, assetId, refreshKey]);

  return (
    <div className="lc-timeline-wrap">
      <div className="lc-timeline-head">
        <h4>Lifecycle history &amp; system logs</h4>
        <span className="lc-auto-badge">Auto-tracked</span>
      </div>

      {loading ? <p className="lc-muted">Loading timeline…</p> : null}
      {!loading && error ? <p className="error-text">{error}</p> : null}
      {!loading && !error && events.length === 0 ? (
        <p className="lc-muted">No lifecycle events yet.</p>
      ) : null}

      {!loading && events.length > 0 ? (
        <ol className="lc-timeline">
          {events.map((ev) => (
            <li key={ev.id} className="lc-item">
              <span className={`lc-dot ${toneClass(ev.tone)}`} aria-hidden />
              <div className="lc-body">
                <strong className="lc-title">{ev.title}</strong>
                <p className="lc-detail">{ev.detail}</p>
                <time className="lc-date" dateTime={ev.date || ev.at || undefined}>
                  {ev.date || (ev.at ? String(ev.at).slice(0, 10) : '—')}
                </time>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <style>{`
        .lc-timeline-wrap { display: flex; flex-direction: column; gap: 0.85rem; }
        .lc-timeline-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 0.75rem; flex-wrap: wrap;
        }
        .lc-timeline-head h4 {
          margin: 0;
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: #94a3b8;
        }
        .lc-auto-badge {
          display: inline-flex;
          align-items: center;
          padding: 0.22rem 0.65rem;
          border-radius: 999px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          font-size: 0.72rem;
          font-weight: 700;
          color: #64748b;
        }
        .lc-timeline {
          list-style: none;
          margin: 0;
          padding: 0.15rem 0 0.35rem 0.35rem;
          position: relative;
        }
        .lc-timeline::before {
          content: '';
          position: absolute;
          left: 0.52rem;
          top: 0.35rem;
          bottom: 0.35rem;
          width: 2px;
          background: #e2e8f0;
          border-radius: 2px;
        }
        .lc-item {
          position: relative;
          display: grid;
          grid-template-columns: 1.2rem 1fr;
          gap: 0.75rem;
          padding: 0 0 1.15rem;
        }
        .lc-item:last-child { padding-bottom: 0.15rem; }
        .lc-dot {
          width: 0.7rem;
          height: 0.7rem;
          margin-top: 0.28rem;
          border-radius: 50%;
          border: 2px solid #fff;
          box-shadow: 0 0 0 2px #e2e8f0;
          z-index: 1;
          justify-self: center;
        }
        .lc-dot--success { background: #22c55e; box-shadow: 0 0 0 2px #bbf7d0; }
        .lc-dot--info { background: #3b82f6; box-shadow: 0 0 0 2px #bfdbfe; }
        .lc-dot--primary { background: #2563eb; box-shadow: 0 0 0 2px #bfdbfe; }
        .lc-dot--warning { background: #f59e0b; box-shadow: 0 0 0 2px #fde68a; }
        .lc-dot--danger { background: #ef4444; box-shadow: 0 0 0 2px #fecaca; }
        .lc-dot--neutral { background: #94a3b8; box-shadow: 0 0 0 2px #e2e8f0; }
        .lc-title {
          display: block;
          font-size: 0.95rem;
          font-weight: 750;
          color: #0f172a;
          line-height: 1.35;
        }
        .lc-detail {
          margin: 0.2rem 0 0;
          font-size: 0.86rem;
          color: #64748b;
          line-height: 1.45;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .lc-date {
          display: block;
          margin-top: 0.35rem;
          font-size: 0.78rem;
          font-weight: 600;
          color: #94a3b8;
          font-variant-numeric: tabular-nums;
        }
        .lc-muted { margin: 0; color: var(--muted); font-size: 0.9rem; }
      `}</style>
    </div>
  );
}
