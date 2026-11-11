import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/ui/PageHeader';
import StatusBadge from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import { DataTableShell } from '../components/ui/DataTable';
import { api } from '../services/client';

type Row = Record<string, unknown>;

type Props = {
  title: string;
  subtitle: string;
  endpoint: string;
  columns: { key: string; label: string }[];
  searchKeys?: string[];
};

export default function MetaListPage({ title, subtitle, endpoint, columns, searchKeys }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await api<{ data: Row[] }>(endpoint);
      setRows(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [endpoint]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    const keys = searchKeys ?? columns.map((c) => c.key);
    return rows.filter((r) =>
      keys.some((k) => String(r[k] ?? '').toLowerCase().includes(term)),
    );
  }, [rows, q, columns, searchKeys]);

  return (
    <main className="page page--fill">
      <PageHeader
        title={title}
        subtitle={subtitle}
      />

      <DataTableShell
        toolbar={
          <div className="toolbar">
            <input
              className="input"
              placeholder={`Search ${title.toLowerCase()}…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        }
      >
        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : error ? (
          <ErrorState title={`Unable to load ${title.toLowerCase()}`} description={error} onRetry={() => void load()} />
        ) : filtered.length === 0 ? (
          <EmptyState title={`No ${title.toLowerCase()} found`} description="Try adjusting your search or refresh the list." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={String(r.id)}>
                  {columns.map((c) => (
                    <td key={c.key}>{dash(r[c.key])}</td>
                  ))}
                  <td>
                    <StatusBadge status="active" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableShell>
    </main>
  );
}

function dash(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}
