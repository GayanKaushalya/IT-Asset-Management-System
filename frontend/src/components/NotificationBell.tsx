import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/client';

type Notif = {
  id: string;
  db_id?: number;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  is_read?: boolean;
  created_at?: string;
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: Notif[]; unread: number }>('/api/notifications?limit=30');
      const list = (res.data ?? []).filter((n) => !n.is_read);
      setItems(list);
      setUnread(Number(res.unread ?? list.length));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const clearAll = async () => {
    try {
      await api('/api/notifications/read-all', { method: 'POST' });
      setItems([]);
      setUnread(0);
    } catch {
      /* ignore */
    }
  };

  const dismissOne = async (n: Notif) => {
    try {
      await api(`/api/notifications/${encodeURIComponent(n.db_id ?? n.id)}/read`, { method: 'POST' });
      setItems((prev) => prev.filter((x) => x.id !== n.id));
      setUnread((u) => Math.max(0, u - 1));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="notif-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-bell-btn"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load();
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 ? <span className="notif-badge">{unread > 9 ? '9+' : unread}</span> : null}
      </button>

      {open ? (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-panel-head">
            <strong>Warranty alerts</strong>
            {items.length > 0 ? (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                onClick={() => void clearAll()}
              >
                Clear all
              </button>
            ) : null}
          </div>
          <ul className="notif-list">
            {items.length === 0 ? (
              <li className="notif-empty">No warranty alerts right now.</li>
            ) : (
              items.map((n) => (
                <li key={n.id} className="unread">
                  <Link
                    to={n.link || '/reports/maintenance'}
                    onClick={() => {
                      void dismissOne(n);
                      setOpen(false);
                    }}
                  >
                    <span className="notif-title">{n.title}</span>
                    {n.body ? <span className="notif-body">{n.body}</span> : null}
                  </Link>
                  <button
                    type="button"
                    className="notif-dismiss"
                    aria-label="Dismiss alert"
                    title="Dismiss"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void dismissOne(n);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}

      <style>{`
        .notif-bell-wrap { position: relative; }
        .notif-bell-btn {
          position: relative;
          width: 38px; height: 38px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: #fff;
          color: #334155;
          display: grid; place-items: center;
          cursor: pointer;
        }
        .notif-bell-btn:hover { background: #f8fafc; }
        .notif-badge {
          position: absolute; top: -4px; right: -4px;
          min-width: 18px; height: 18px; padding: 0 4px;
          border-radius: 999px; background: #dc2626; color: #fff;
          font-size: 0.65rem; font-weight: 700;
          display: grid; place-items: center;
        }
        .notif-panel {
          position: absolute; right: 0; top: calc(100% + 8px);
          width: min(360px, 92vw);
          background: #fff; border: 1px solid var(--border);
          border-radius: 12px; box-shadow: 0 16px 40px rgba(15,23,42,0.14);
          z-index: 80; overflow: hidden;
        }
        .notif-panel-head {
          display: flex; justify-content: space-between; align-items: center;
          padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border);
        }
        .notif-list { list-style: none; margin: 0; padding: 0; max-height: 360px; overflow: auto; }
        .notif-list li {
          position: relative;
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: start;
          border-bottom: 1px solid #f1f5f9;
        }
        .notif-list li a {
          display: flex; flex-direction: column; gap: 0.15rem;
          padding: 0.7rem 0.85rem; padding-right: 2rem;
          text-decoration: none; color: inherit;
        }
        .notif-list li.unread { background: #eff6ff; }
        .notif-list li a:hover { background: #f8fafc; }
        .notif-dismiss {
          position: absolute; top: 0.45rem; right: 0.45rem;
          width: 24px; height: 24px;
          border: none; border-radius: 6px;
          background: transparent; color: #94a3b8;
          font-size: 1.1rem; line-height: 1; cursor: pointer;
        }
        .notif-dismiss:hover { background: #e2e8f0; color: #0f172a; }
        .notif-title { font-weight: 650; font-size: 0.88rem; color: #0f172a; }
        .notif-body { font-size: 0.8rem; color: #64748b; }
        .notif-empty { padding: 1.25rem; color: #94a3b8; font-size: 0.88rem; text-align: center; }
      `}</style>
    </div>
  );
}
