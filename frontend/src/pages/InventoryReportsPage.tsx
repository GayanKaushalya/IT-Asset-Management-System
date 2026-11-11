import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader, { LiveRepositoryBadge } from '../components/ui/PageHeader';
import StatusBadge, { assetStatusLabel } from '../components/ui/StatusBadge';
import { api } from '../services/client';
import { LoadingSkeleton, ErrorState } from '../components/ui/EmptyState';

type CompanyTab = 'ALL' | 'IT' | 'IMS' | 'ISP';

type GroupRow = {
  key: string;
  label: string;
  category: string;
  status: string;
  count: number;
};

type StockRow = {
  id: number;
  asset_tag: string;
  category: string;
  brand?: string | null;
  model?: string | null;
  status: string;
  company?: string;
  location_name?: string | null;
};

type WarrantyRow = {
  id: number;
  asset_tag: string;
  category: string;
  company?: string;
  warranty_expires_on: string;
  days_remaining: number;
};

type HandoverRow = {
  id: number;
  asset_tag?: string;
  asset_type?: string;
  assigned_person_name?: string;
  handover_date?: string;
  return_date?: string | null;
  is_open?: boolean;
  company?: string;
};

type InventoryPayload = {
  byCompany: GroupRow[];
  byLocation: GroupRow[];
  byDepartment: GroupRow[];
  unassignedStock: StockRow[];
  lifecycle: { status: string; count: number }[];
  warranties: WarrantyRow[];
  handoverHistory: HandoverRow[];
};

const TABS: { id: CompanyTab; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'IT', label: 'ITL' },
  { id: 'IMS', label: 'IMS' },
  { id: 'ISP', label: 'ISP' },
];

function dash(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v);
}

function catLabel(c: string): string {
  if (c === 'mobile_phone') return 'Mobile';
  if (c === 'laptop') return 'Laptop';
  if (c === 'pc') return 'PC';
  return c.replace(/_/g, ' ');
}

function rollup(rows: GroupRow[]): { label: string; total: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.label, (map.get(r.label) ?? 0) + r.count);
  }
  return [...map.entries()]
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
}

export default function InventoryReportsPage() {
  const [company, setCompany] = useState<CompanyTab>('ALL');
  const [data, setData] = useState<InventoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'stock' | 'location' | 'dept' | 'warranty' | 'handover' | 'lifecycle'>('stock');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api<InventoryPayload>(`/api/reports/inventory?company=${company}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [company]);

  const byLoc = useMemo(() => rollup(data?.byLocation ?? []), [data]);
  const byDept = useMemo(() => rollup(data?.byDepartment ?? []), [data]);

  const exportCsv = (filename: string, headers: string[], rows: string[][]) => {
    const lines = [headers, ...rows].map((r) =>
      r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','),
    );
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="page">
      <PageHeader
        eyebrow="Reports"
        title="Inventory Reports"
        badge={<LiveRepositoryBadge />}
        subtitle="Stock by company, location, and department · warranties · handover history"
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Link to="/reports/assets" className="btn btn-ghost">
              Person search
            </Link>
            <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
              Print / PDF
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!data}
              onClick={() => {
                if (!data) return;
                exportCsv(
                  `itams-stock-${company}-${new Date().toISOString().slice(0, 10)}.csv`,
                  ['Asset tag', 'Category', 'Company', 'Location', 'Brand', 'Model', 'Status'],
                  data.unassignedStock.map((r) => [
                    r.asset_tag,
                    r.category,
                    r.company ?? '',
                    r.location_name ?? '',
                    r.brand ?? '',
                    r.model ?? '',
                    r.status,
                  ]),
                );
              }}
            >
              Export stock CSV
            </button>
          </div>
        }
      />

      <div className="tabs-secondary no-print">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab-btn${company === t.id ? ' active' : ''}`}
            onClick={() => setCompany(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <LoadingSkeleton rows={6} /> : null}
      {error ? <ErrorState description={error} /> : null}

      {data && !loading ? (
        <>
          <section className="stat-row report-stat-row">
            {(data.lifecycle ?? []).map((s) => (
              <div key={s.status} className="card" style={{ padding: '0.85rem 1rem' }}>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase' }}>
                  {assetStatusLabel(s.status)}
                </p>
                <strong style={{ fontSize: '1.4rem' }}>{s.count}</strong>
              </div>
            ))}
          </section>

          <div className="tabs-secondary no-print" style={{ marginTop: '0.5rem' }}>
            {(
              [
                ['stock', 'Unassigned stock'],
                ['location', 'By location'],
                ['dept', 'By department'],
                ['warranty', 'Warranties'],
                ['handover', 'Handover history'],
                ['lifecycle', 'Lifecycle'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`tab-btn${tab === id ? ' active' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="card" style={{ marginTop: '0.75rem' }}>
            {tab === 'stock' ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Type</th>
                    <th>Company</th>
                    <th>Location</th>
                    <th>Brand / model</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.unassignedStock.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ color: 'var(--muted)' }}>
                        No available (unassigned) stock.
                      </td>
                    </tr>
                  ) : (
                    data.unassignedStock.map((r) => (
                      <tr key={`${r.category}-${r.id}`}>
                        <td>{r.asset_tag}</td>
                        <td>{catLabel(r.category)}</td>
                        <td>{dash(r.company)}</td>
                        <td>{dash(r.location_name)}</td>
                        <td>
                          {[r.brand, r.model].filter(Boolean).join(' ') || '—'}
                        </td>
                        <td>
                          <StatusBadge status={r.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : null}

            {tab === 'location' ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>Assets</th>
                  </tr>
                </thead>
                <tbody>
                  {byLoc.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td>{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {tab === 'dept' ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Assets</th>
                  </tr>
                </thead>
                <tbody>
                  {byDept.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td>{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {tab === 'warranty' ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Type</th>
                    <th>Company</th>
                    <th>Expires</th>
                    <th>Days left</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.warranties ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ color: 'var(--muted)' }}>
                        No warranties due in the next 90 days.
                      </td>
                    </tr>
                  ) : (
                    data.warranties.map((r) => (
                      <tr key={`${r.category}-${r.id}`}>
                        <td>{r.asset_tag}</td>
                        <td>{catLabel(r.category)}</td>
                        <td>{dash(r.company)}</td>
                        <td>{r.warranty_expires_on}</td>
                        <td style={{ color: r.days_remaining < 0 ? '#dc2626' : r.days_remaining <= 30 ? '#d97706' : undefined }}>
                          {r.days_remaining}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : null}

            {tab === 'handover' ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Person</th>
                    <th>Company</th>
                    <th>Handover</th>
                    <th>Return</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.handoverHistory ?? []).map((r) => (
                    <tr key={r.id}>
                      <td>{dash(r.asset_tag)}</td>
                      <td>{dash(r.assigned_person_name)}</td>
                      <td>{dash(r.company)}</td>
                      <td>{dash(r.handover_date)}</td>
                      <td>{dash(r.return_date)}</td>
                      <td>{r.is_open ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {tab === 'lifecycle' ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.lifecycle ?? []).map((r) => (
                    <tr key={r.status}>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        </>
      ) : null}

      <style>{`
        .report-stat-row {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 0.75rem;
          margin: 0.75rem 0;
        }
        @media print {
          .no-print, .sidebar, .app-footer, .mobile-menu-fab { display: none !important; }
          .main-pane { margin: 0 !important; }
          .page { padding: 0 !important; }
        }
      `}</style>
    </main>
  );
}
