import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import { DataTableShell } from '../components/ui/DataTable';
import { api } from '../services/client';

type AuditRow = {
  id: number;
  action: string;
  details?: Record<string, unknown> | null;
  ip_address?: string | null;
  created_at?: string;
  actor_name?: string | null;
  actor_email?: string | null;
  actor_role?: string | null;
  target_name?: string | null;
  target_email?: string | null;
  target_role?: string | null;
};

type SessionRow = {
  id: number;
  user_name?: string;
  user_email?: string;
  user_role?: string;
  company_short?: string;
  label?: string;
  created_at?: string;
  last_used_at?: string | null;
  expires_at?: string | null;
};

type Tab = 'logins' | 'access' | 'sessions' | 'all';

function formatWhen(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    login: 'Login',
    logout: 'Logout',
    register: 'Self-register',
    login_failed: 'Failed login',
    user_create: 'User created',
    user_role_change: 'Role changed',
    user_activate: 'User activated',
    user_deactivate: 'User deactivated',
    user_update: 'User updated',
    backup_create: 'Backup created',
    backup_download: 'Backup downloaded',
    backup_restore: 'Backup restored',
  };
  return map[action] ?? action.replace(/_/g, ' ');
}

function detailText(row: AuditRow): string {
  const d = row.details ?? {};
  if (row.action === 'user_role_change') {
    return `${String(d.from ?? '?')} → ${String(d.to ?? '?')}`;
  }
  if (d.email) return String(d.email);
  if (d.reason) return String(d.reason);
  return '';
}

export default function AuditLogsPage() {
  const [tab, setTab] = useState<Tab>('logins');
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      if (tab === 'sessions') {
        const res = await api<{ data: SessionRow[] }>('/api/audit-logs/sessions');
        setSessions(res.data ?? []);
        setRows([]);
      } else {
        const action = tab === 'all' ? '' : tab === 'logins' ? 'auth' : 'access';
        const qs = action ? `?action=${encodeURIComponent(action)}` : '';
        const res = await api<{ data: AuditRow[] }>(`/api/audit-logs${qs}`);
        setRows(res.data ?? []);
        setSessions([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const onVis = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const filteredLogs = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.action, r.actor_name, r.actor_email, r.target_name, r.target_email, detailText(r)]
        .some((v) => String(v ?? '').toLowerCase().includes(term)),
    );
  }, [rows, q]);

  const filteredSessions = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return sessions;
    return sessions.filter((r) =>
      [r.user_name, r.user_email, r.user_role, r.company_short]
        .some((v) => String(v ?? '').toLowerCase().includes(term)),
    );
  }, [sessions, q]);

  return (
    <main className="page page--fill">
      <PageHeader
        eyebrow="System"
        title="Audit Logs"
        subtitle="Logins, sessions, and access-type changes"
      />

      <div className="toolbar" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {(
          [
            ['logins', 'Logins'],
            ['access', 'Access changes'],
            ['sessions', 'Active sessions'],
            ['all', 'All'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`btn ${tab === id ? 'btn-primary' : 'btn-soft'}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <DataTableShell
        toolbar={
          <input
            className="input"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: '14rem', flex: 1 }}
          />
        }
      >
        {loading ? (
          <LoadingSkeleton rows={8} />
        ) : error ? (
          <ErrorState description={error} onRetry={() => void load()} />
        ) : tab === 'sessions' ? (
          filteredSessions.length === 0 ? (
            <EmptyState title="No active sessions" description="Users appear here after they log in." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Access type</th>
                  <th>Company</th>
                  <th>Session started</th>
                  <th>Last used</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div>{r.user_name ?? '—'}</div>
                      <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{r.user_email ?? ''}</div>
                    </td>
                    <td style={{ textTransform: 'capitalize' }}>{String(r.user_role ?? '—').replace(/_/g, ' ')}</td>
                    <td>{r.company_short ?? '—'}</td>
                    <td>{formatWhen(r.created_at)}</td>
                    <td>{formatWhen(r.last_used_at)}</td>
                    <td>{formatWhen(r.expires_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : filteredLogs.length === 0 ? (
          <EmptyState
            title="No audit events yet"
            description="Logins and access changes will appear here after users use the system."
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Actor</th>
                <th>Access type</th>
                <th>Target user</th>
                <th>Details</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((r) => (
                <tr key={r.id}>
                  <td>{formatWhen(r.created_at)}</td>
                  <td>{actionLabel(r.action)}</td>
                  <td>
                    <div>{r.actor_name ?? '—'}</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{r.actor_email ?? ''}</div>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>
                    {String(r.actor_role ?? r.details?.role ?? '—').replace(/_/g, ' ')}
                  </td>
                  <td>
                    <div>{r.target_name ?? '—'}</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{r.target_email ?? ''}</div>
                  </td>
                  <td>{detailText(r) || '—'}</td>
                  <td>{r.ip_address ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableShell>
    </main>
  );
}
