import { useEffect, useState } from 'react';
import { api } from '../services/client';

export type AgreementHistoryEvent = {
  id: number | string;
  type: string;
  tone?: 'success' | 'info' | 'primary' | 'warning' | 'danger' | 'neutral';
  title: string;
  detail: string;
  at?: string | null;
  date?: string | null;
  changed_by_name?: string | null;
};

type Props = {
  agreementId: number;
  /** Bump to reload after renew / edit / document upload */
  refreshKey?: number;
};

function dotClass(tone?: string, type?: string): string {
  const t = tone || type || '';
  switch (t) {
    case 'success':
    case 'created':
      return 'green';
    case 'info':
    case 'primary':
    case 'renewed':
    case 'document_uploaded':
      return 'blue';
    case 'warning':
    case 'status_changed':
      return 'amber';
    case 'danger':
    case 'removed':
      return 'red';
    default:
      return '';
  }
}

function formatWhen(ev: AgreementHistoryEvent): string {
  if (ev.at) {
    const d = new Date(ev.at);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('en-LK');
  }
  if (ev.date) return String(ev.date).slice(0, 10);
  return '—';
}

export default function AgreementHistoryTimeline({ agreementId, refreshKey = 0 }: Props) {
  const [events, setEvents] = useState<AgreementHistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await api<{ data: AgreementHistoryEvent[] }>(
          `/api/agreements/${agreementId}/history`,
        );
        if (!cancelled) setEvents(res.data ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load history');
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
  }, [agreementId, refreshKey]);

  return (
    <section className="avm-panel avm-panel--lifecycle agr-lc-panel">
      <div className="avm-panel-head">
        <h4>Lifecycle History &amp; System Logs</h4>
        <span className="avm-pill muted">Auto-tracked</span>
      </div>

      {loading ? <p className="avm-empty">Loading timeline…</p> : null}
      {!loading && error ? <p className="error-text">{error}</p> : null}
      {!loading && !error && events.length === 0 ? (
        <p className="avm-empty">No lifecycle events yet.</p>
      ) : null}

      {!loading && events.length > 0 ? (
        <div className="avm-timeline agr-lc-timeline">
          {events.map((ev) => {
            const color = dotClass(ev.tone, ev.type);
            return (
              <div key={ev.id} className="avm-tl-item">
                <span className={`avm-tl-dot${color ? ` ${color}` : ''}`} aria-hidden />
                <div>
                  <strong>{ev.title}</strong>
                  {ev.detail ? <p>{ev.detail}</p> : null}
                  <time dateTime={ev.date || ev.at || undefined}>{formatWhen(ev)}</time>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <style>{`
        .agr-lc-panel.avm-panel {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 0.95rem 1rem;
          box-shadow: none;
        }
        .agr-lc-panel .avm-panel-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.8rem;
        }
        .agr-lc-panel .avm-panel-head h4 {
          margin: 0;
          font-size: 0.7rem;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: #6b7280;
          font-weight: 750;
        }
        .agr-lc-panel .avm-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          border-radius: 999px;
          padding: 0.18rem 0.55rem;
          font-size: 0.72rem;
          font-weight: 700;
          white-space: nowrap;
        }
        .agr-lc-panel .avm-pill.muted {
          background: #f3f4f6;
          color: #6b7280;
          border: 1px solid #e5e7eb;
        }
        .agr-lc-timeline.avm-timeline {
          display: grid;
          gap: 0;
          position: relative;
          max-height: min(16rem, 40vh);
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding-right: 0.15rem;
        }
        .agr-lc-panel .avm-tl-item {
          display: grid;
          grid-template-columns: 18px minmax(0, 1fr);
          gap: 0.65rem;
          position: relative;
          padding-bottom: 1rem;
        }
        .agr-lc-panel .avm-tl-item:last-child { padding-bottom: 0; }
        .agr-lc-panel .avm-tl-item:not(:last-child)::before {
          content: '';
          position: absolute;
          left: 7px;
          top: 14px;
          bottom: 0;
          width: 2px;
          background: #e5e7eb;
        }
        .agr-lc-panel .avm-tl-dot {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          margin-top: 3px;
          border: 2px solid #fff;
          box-shadow: 0 0 0 1px #e5e7eb;
          background: #94a3b8;
        }
        .agr-lc-panel .avm-tl-dot.green { background: #22c55e; box-shadow: 0 0 0 1px #86efac; }
        .agr-lc-panel .avm-tl-dot.blue { background: #2563eb; box-shadow: 0 0 0 1px #93c5fd; }
        .agr-lc-panel .avm-tl-dot.amber { background: #f59e0b; box-shadow: 0 0 0 1px #fcd34d; }
        .agr-lc-panel .avm-tl-dot.red { background: #ef4444; box-shadow: 0 0 0 1px #fca5a5; }
        .agr-lc-panel .avm-tl-item strong { display: block; font-size: 0.9rem; color: #111827; }
        .agr-lc-panel .avm-tl-item p {
          margin: 0.15rem 0 0;
          color: #6b7280;
          font-size: 0.82rem;
          line-height: 1.35;
        }
        .agr-lc-panel .avm-tl-item time {
          display: block;
          margin-top: 0.2rem;
          color: #9ca3af;
          font-size: 0.76rem;
        }
        .agr-lc-panel .avm-empty { color: #9ca3af; font-size: 0.86rem; margin: 0; }
      `}</style>
    </section>
  );
}
