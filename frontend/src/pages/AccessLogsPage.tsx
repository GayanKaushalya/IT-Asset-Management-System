import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import { DataTableShell } from '../components/ui/DataTable';
import { api } from '../services/client';

type LogRow = {
  id: number;
  action: string;
  system_name?: string;
  username?: string;
  credential_type?: string;
  company_short?: string;
  user_name?: string;
  user_email?: string;
  user_role?: string;
  ip_address?: string | null;
  created_at?: string;
};

function formatWhen(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    view_decrypt: 'Reveal password',
    create: 'Create',
    update: 'Update',
    delete: 'Delete',
  };
  return map[action] ?? action.replace(/_/g, ' ');
}

export default function AccessLogsPage() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await api<{ data: LogRow[] }>('/api/credentials/access-logs');
      setRows(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load access logs');
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
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.user_name, r.user_email, r.system_name, r.username, r.action, r.credential_type, r.company_short]
        .some((v) => String(v ?? '').toLowerCase().includes(term)),
    );
  }, [rows, q]);

  return (
    <main className="page page--fill">
      <PageHeader
        eyebrow="Credential Management"
        title="Credential Access Logs"
        subtitle="Who revealed or changed vault credentials"
      />

      <DataTableShell
        toolbar={
          <input
            className="input"
            placeholder="Search by user, system, action…"
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
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No vault access yet"
            description="Reveal, create, or update a credential to see entries here."
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Access type</th>
                <th>Action</th>
                <th>System</th>
                <th>Username</th>
                <th>Company</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{formatWhen(r.created_at)}</td>
                  <td>
                    <div>{r.user_name ?? '—'}</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{r.user_email ?? ''}</div>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{String(r.user_role ?? '—').replace(/_/g, ' ')}</td>
                  <td>{actionLabel(r.action)}</td>
                  <td>{r.system_name ?? '—'}</td>
                  <td>{r.username ?? '—'}</td>
                  <td>{r.company_short ?? '—'}</td>
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
