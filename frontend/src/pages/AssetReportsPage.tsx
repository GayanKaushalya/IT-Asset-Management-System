import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { LiveRepositoryBadge } from '../components/ui/PageHeader';
import StatusBadge from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import { DataTableShell } from '../components/ui/DataTable';
import PaginationBar from '../components/ui/PaginationBar';
import TableSettingsMenu, { type PageSize } from '../components/ui/TableSettingsMenu';
import { api } from '../services/client';

const PAGE_SIZE_KEY = 'itams.reports.assets.pageSize';

function readStoredPageSize(): PageSize {
  try {
    const raw = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (raw === 5 || raw === 10 || raw === 20 || raw === 50 || raw === 100 || raw === 500) return raw;
  } catch {
    /* ignore */
  }
  return 10;
}

type CompanyTab = 'ALL' | 'IT' | 'IMS' | 'ISP';
type StatFilter = 'holds' | 'laptop' | 'phone' | 'other' | 'total';

type EmpRow = {
  id: number;
  staff_id: string;
  name: string;
  title?: string | null;
  display_name?: string | null;
  epf_number?: string | null;
  employment_status?: string;
  designation?: string | null;
  work_location?: string | null;
  department_name?: string | null;
  company_code?: string;
  company_short?: string;
  company_name?: string;
  laptop_count?: number;
  phone_count?: number;
  asset_count?: number;
};

type AssetRow = {
  id: number;
  category: string;
  asset_tag: string;
  brand?: string | null;
  model?: string | null;
  status?: string | null;
  company_short?: string | null;
  company_code?: string | null;
  location_name?: string | null;
  role: string;
  matched_field?: string | null;
  matched_value?: string | null;
};

type EmpDetail = {
  employee: EmpRow;
  assets: AssetRow[];
  summary: {
    laptop: number;
    mobile_phone: number;
    pc?: number;
    printer?: number;
    other?: number;
    current: number;
    related: number;
    total: number;
  };
};

const COMPANY_TABS: { id: CompanyTab; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'IT', label: 'ITL' },
  { id: 'IMS', label: 'IMS' },
  { id: 'ISP', label: 'ISP' },
];

function dash(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v);
}

function companyUiLabel(code?: unknown): string {
  const c = String(code ?? '')
    .trim()
    .toUpperCase();
  if (c === 'IT' || c === 'ITL') return 'ITL';
  if (c === 'IMS') return 'IMS';
  if (c === 'ISP') return 'ISP';
  return c || '—';
}

function categoryLabel(c: string): string {
  if (c === 'mobile_phone') return 'Mobile phone';
  if (c === 'laptop') return 'Laptop';
  if (c === 'pc') return 'PC';
  if (c === 'other') return 'Other';
  if (c === 'printer') return 'Printer';
  return c.replace(/_/g, ' ');
}

function roleLabel(role: string): string {
  if (role === 'current') return 'Current holder';
  if (role === 'original') return 'Originally assigned';
  if (role === 'handover') return 'Handover history';
  return role;
}

function roleTone(role: string): 'active' | 'info' | 'neutral' {
  if (role === 'current') return 'active';
  if (role === 'original') return 'info';
  return 'neutral';
}

function assetPath(category: string): string {
  if (category === 'mobile_phone') return '/assets/mobile-phones';
  if (category === 'laptop') return '/assets/laptop';
  if (category === 'pc') return '/assets/all';
  if (category === 'other') return '/assets/others';
  return '/assets/all';
}

function matchesEmployee(r: EmpRow, term: string): boolean {
  const raw = term.trim().toLowerCase();
  if (!raw) return true;
  const tokens = raw.split(/\s+/).filter(Boolean);
  const hay = [
    r.staff_id,
    r.name,
    r.display_name,
    r.title,
    r.epf_number,
    r.designation,
    r.work_location,
    r.department_name,
    r.company_code,
    r.company_short,
    r.company_name,
    r.employment_status,
  ]
    .map((v) => String(v ?? '').toLowerCase())
    .join(' ');
  return tokens.every((t) => hay.includes(t));
}

function formatSyncedAt(d: Date): string {
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `today, ${time}` : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

export default function AssetReportsPage() {
  const navigate = useNavigate();
  const [company, setCompany] = useState<CompanyTab>('ALL');
  const [q, setQ] = useState('');
  const [allRows, setAllRows] = useState<EmpRow[]>([]);
  const [assetHits, setAssetHits] = useState<EmpRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<EmpDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailSyncedAt, setDetailSyncedAt] = useState<Date | null>(null);
  const [statFilter, setStatFilter] = useState<StatFilter>('holds');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(() => readStoredPageSize());

  async function loadList() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (company !== 'ALL') params.set('company', company);
      const res = await api<{ data: EmpRow[] }>(`/api/reports/employees?${params.toString()}`);
      setAllRows(res.data ?? []);
      setAssetHits(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load employees');
      setAllRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setAssetHits(null);
      return;
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ limit: '150', q: term });
          if (company !== 'ALL') params.set('company', company);
          const res = await api<{ data: EmpRow[] }>(`/api/reports/employees?${params.toString()}`);
          setAssetHits(res.data ?? []);
        } catch {
          setAssetHits(null);
        }
      })();
    }, 280);
    return () => window.clearTimeout(handle);
  }, [q, company]);

  const rows = useMemo(() => {
    const term = q.trim();
    if (assetHits) return assetHits;
    if (!term) return allRows;
    return allRows.filter((r) => matchesEmployee(r, term));
  }, [allRows, assetHits, q]);

  useEffect(() => {
    setPage(1);
  }, [q, company, pageSize, rows.length]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, safePage, pageSize]);
  const rangeFrom = rows.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeTo = Math.min(safePage * pageSize, rows.length);

  function changePageSize(size: PageSize) {
    setPageSize(size);
    setPage(1);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      /* ignore */
    }
  }

  async function openEmployee(id: number) {
    setSelectedId(id);
    setStatFilter('holds');
    setDetailLoading(true);
    setDetailError('');
    try {
      const res = await api<{ data: EmpDetail }>(`/api/reports/employees/${id}`);
      setDetail(res.data);
      setDetailSyncedAt(new Date());
    } catch (e) {
      setDetail(null);
      setDetailError(e instanceof Error ? e.message : 'Failed to load employee');
    } finally {
      setDetailLoading(false);
    }
  }

  const selected = useMemo(
    () => allRows.find((r) => r.id === selectedId) ?? detail?.employee ?? null,
    [allRows, selectedId, detail],
  );

  const currentAssets = detail?.assets.filter((a) => a.role === 'current') ?? [];
  const historyAssets = detail?.assets.filter((a) => a.role !== 'current') ?? [];

  const otherSummary =
    Number(detail?.summary.pc ?? 0) +
    Number(detail?.summary.other ?? 0) +
    Number(detail?.summary.printer ?? 0);

  const filteredCurrent = useMemo(() => {
    if (statFilter === 'laptop') return currentAssets.filter((a) => a.category === 'laptop');
    if (statFilter === 'phone') return currentAssets.filter((a) => a.category === 'mobile_phone');
    if (statFilter === 'other')
      return currentAssets.filter((a) => a.category === 'pc' || a.category === 'other' || a.category === 'printer');
    return currentAssets;
  }, [currentAssets, statFilter]);

  function openAsset(a: AssetRow) {
    const code = String(a.company_code ?? a.company_short ?? '').toUpperCase();
    const companyParam = code === 'ITL' ? 'IT' : code || 'IT';
    const params = new URLSearchParams();
    params.set('view', String(a.id));
    params.set('company', companyParam);
    params.set('returnTo', '/reports/assets');
    navigate(`${assetPath(a.category)}?${params.toString()}`);
  }

  return (
    <main className="page page--fill arp">
      <div className="no-print">
        <PageHeader
          eyebrow="Reports"
          title="Asset Reports"
          badge={<LiveRepositoryBadge />}
          subtitle="Search a person by name or staff ID — click a record to generate their full asset report (laptops, phones, PCs & peripherals)."
        />
      </div>

      <div className="arp-search-row no-print">
        <div className="arp-search-wrap">
          <span className="arp-search-icon" aria-hidden>
            <IconSearch />
          </span>
          <input
            className="arp-search-input"
            placeholder="Search person name, staff ID, department, location…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            autoFocus
          />
          {q.trim() ? (
            <button type="button" className="arp-clear" onClick={() => setQ('')}>
              Clear
            </button>
          ) : null}
        </div>
        <div className="arp-company-pills" role="tablist" aria-label="Company filter">
          {COMPANY_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={company === t.id}
              className={`arp-pill${company === t.id ? ' is-active' : ''}`}
              onClick={() => setCompany(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="arp-layout">
        <section className="arp-list no-print">
          <DataTableShell
            toolbar={
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.8rem' }}>
                  {q.trim()
                    ? `Results for “${q.trim()}” — click a person to open their report`
                    : 'Type a name above, or pick someone from the list'}
                </p>
                <div className="asset-filter-actions" style={{ margin: 0 }}>
                  <span style={{ color: 'var(--muted)', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                    {rows.length === 0 ? '0 shown' : `${rangeFrom}–${rangeTo} of ${rows.length}`}
                  </span>
                  <TableSettingsMenu
                    pageSize={pageSize}
                    onPageSizeChange={changePageSize}
                    onRefresh={() => void loadList()}
                    refreshing={loading}
                    rangeLabel={
                      rows.length === 0 ? '0 of 0' : `${rangeFrom} - ${rangeTo} of ${rows.length}`
                    }
                  />
                  <PaginationBar
                    page={safePage}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    disabled={loading || rows.length === 0}
                  />
                </div>
              </div>
            }
          >
            {loading ? (
              <LoadingSkeleton rows={10} />
            ) : error ? (
              <ErrorState description={error} onRetry={() => void loadList()} />
            ) : rows.length === 0 ? (
              <EmptyState
                title="No employees found"
                description={q.trim() ? `No matches for “${q.trim()}”.` : 'Try another company filter.'}
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((r) => (
                    <tr
                      key={r.id}
                      className={selectedId === r.id ? 'is-selected' : undefined}
                      style={{ cursor: 'pointer' }}
                      onClick={() => void openEmployee(r.id)}
                    >
                      <td>{r.staff_id}</td>
                      <td>
                        <strong>{r.display_name || r.name}</strong>
                        {r.designation ? (
                          <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                            {r.designation}
                          </div>
                        ) : null}
                      </td>
                      <td>{r.company_short || r.company_code}</td>
                      <td>{r.work_location || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </DataTableShell>
          <p className="arp-list-count">
            Showing {rows.length === 0 ? 0 : `${rangeFrom}–${rangeTo}`} of {rows.length} employee
            {rows.length === 1 ? '' : 's'}
            {rows.length !== allRows.length ? ` (from ${allRows.length} total)` : ''}
            {q.trim() ? ` matching “${q.trim()}”` : ''}.
          </p>
        </section>

        <section className="arp-detail">
          {!selectedId ? (
            <div className="arp-panel arp-panel--empty">
              <div className="arp-empty-hero">
                <IconUserSearch />
                <h2>Select a person</h2>
                <p>
                  Search by name or staff ID, then click a result to generate a report of every asset
                  they hold or previously used.
                </p>
              </div>
            </div>
          ) : detailLoading ? (
            <div className="arp-panel">
              <LoadingSkeleton rows={8} />
            </div>
          ) : detailError ? (
            <div className="arp-panel">
              <ErrorState
                description={detailError}
                onRetry={() => selectedId && void openEmployee(selectedId)}
              />
            </div>
          ) : detail ? (
            <div className="arp-panel printable-report">
              <header className="arp-person-head">
                <div className="arp-person-title-row">
                  <p className="arp-eyebrow">Person asset report</p>
                  <span className="arp-verified">
                    <IconCheck /> Verified identity
                  </span>
                </div>
                <div className="arp-person-main">
                  <div>
                    <h2>{detail.employee.display_name || detail.employee.name}</h2>
                    <p className="arp-person-line">
                      {companyUiLabel(detail.employee.company_code || detail.employee.company_short)}
                      {' · '}Staff ID {detail.employee.staff_id}
                      {detail.employee.designation ? ` · ${detail.employee.designation}` : ''}
                    </p>
                  </div>
                  <div className="arp-stats" role="tablist" aria-label="Asset summary">
                    {(
                      [
                        ['holds', detail.summary.current, 'Holds now'],
                        ['laptop', detail.summary.laptop, 'Laptops'],
                        ['phone', detail.summary.mobile_phone, 'Phones'],
                        ['other', otherSummary, 'Other'],
                        ['total', detail.summary.total, 'Total'],
                      ] as const
                    ).map(([key, value, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={statFilter === key}
                        className={`arp-stat${statFilter === key ? ' is-active' : ''}`}
                        onClick={() => setStatFilter(key)}
                      >
                        <strong>{value}</strong>
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </header>

              <div className="arp-meta-strip">
                <MetaCell label="EPF" value={dash(detail.employee.epf_number)} />
                <MetaCell
                  label="Status"
                  value={
                    <StatusBadge
                      tone={
                        String(detail.employee.employment_status || '').toLowerCase() === 'probation'
                          ? 'warning'
                          : 'active'
                      }
                      label={String(detail.employee.employment_status || 'Current').toUpperCase()}
                    />
                  }
                />
                <MetaCell label="Location" value={dash(detail.employee.work_location)} />
                <MetaCell label="Department" value={dash(detail.employee.department_name)} />
                <MetaCell
                  label="Company"
                  value={dash(detail.employee.company_name || detail.employee.company_short)}
                />
              </div>

              <div className="arp-section-head">
                <div>
                  <h3>Assets held now</h3>
                  <span className="arp-active-pill">{currentAssets.length} Active</span>
                </div>
                <p className="arp-synced">
                  Last synced: {detailSyncedAt ? formatSyncedAt(detailSyncedAt) : '—'}
                </p>
              </div>

              {filteredCurrent.length === 0 ? (
                <p className="arp-muted">
                  {currentAssets.length === 0
                    ? 'No current assignment matched across laptops, phones, PCs, printers, or other assets.'
                    : 'No assets in this category for the current holder.'}
                </p>
              ) : (
                <AssetTable rows={filteredCurrent} onDetails={openAsset} />
              )}

              <div className="arp-section-head arp-section-head--history">
                <div>
                  <h3>Previously used / handover history</h3>
                  <span className="arp-history-label">Archived lifecycle events</span>
                </div>
              </div>

              {historyAssets.length === 0 ? (
                <div className="arp-history-empty">
                  <IconClock />
                  <p>
                    <strong>No other linked asset history</strong>
                    <span>
                      All devices ever assigned are currently in active possession — or no prior
                      handover chain was recorded for this person.
                    </span>
                  </p>
                </div>
              ) : (
                <AssetTable rows={historyAssets} showRole onDetails={openAsset} />
              )}
            </div>
          ) : (
            <div className="arp-panel">
              <EmptyState
                title="No detail"
                description={selected ? selected.display_name || selected.name : ''}
              />
            </div>
          )}
        </section>
      </div>

      <style>{`
        .arp {
          --arp-blue: #2563eb;
          --arp-blue-soft: #eff6ff;
          --arp-blue-border: #bfdbfe;
          --arp-ink: #0f172a;
          --arp-muted: #64748b;
          --arp-line: #e2e8f0;
          --arp-panel: #ffffff;
          --arp-wash: #f8fafc;
          gap: 0.85rem;
        }
        .arp-search-row {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          flex-wrap: wrap;
          flex-shrink: 0;
        }
        .arp-search-wrap {
          flex: 1 1 18rem;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 0.45rem;
          border: 1px solid var(--arp-line);
          border-radius: 12px;
          background: #fff;
          padding: 0 0.75rem;
          min-height: 44px;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
        }
        .arp-search-wrap:focus-within {
          border-color: #93c5fd;
          box-shadow: 0 0 0 3px rgba(147, 197, 253, 0.35);
        }
        .arp-search-icon { color: #94a3b8; display: inline-flex; }
        .arp-search-icon svg { width: 16px; height: 16px; }
        .arp-search-input {
          flex: 1;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          font-size: 0.92rem;
          padding: 0.55rem 0;
          color: var(--arp-ink);
        }
        .arp-clear {
          border: none;
          background: #f1f5f9;
          color: #475569;
          font-size: 0.78rem;
          font-weight: 700;
          border-radius: 8px;
          padding: 0.28rem 0.55rem;
          cursor: pointer;
        }
        .arp-clear:hover { background: #e2e8f0; }
        .arp-company-pills {
          display: inline-flex;
          gap: 0.3rem;
          padding: 0.25rem;
          border-radius: 999px;
          background: #f1f5f9;
          border: 1px solid var(--arp-line);
        }
        .arp-pill {
          border: none;
          background: transparent;
          color: #64748b;
          font-size: 0.82rem;
          font-weight: 700;
          padding: 0.4rem 0.85rem;
          border-radius: 999px;
          cursor: pointer;
        }
        .arp-pill.is-active {
          background: var(--arp-blue);
          color: #fff;
          box-shadow: 0 4px 10px rgba(37, 99, 235, 0.25);
        }

        .arp-layout {
          display: grid;
          grid-template-columns: minmax(280px, 0.95fr) minmax(340px, 1.25fr);
          gap: 0.9rem;
          flex: 1 1 auto;
          min-height: 0;
          overflow: hidden;
        }
        .arp-list, .arp-detail {
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .arp-list {
          overflow: hidden;
        }
        .arp-list .list-card {
          flex: 1 1 auto;
          min-height: 0;
        }
        .arp-detail { overflow: auto; overscroll-behavior: contain; }
        .arp-panel {
          border: 1px solid var(--arp-line);
          border-radius: 14px;
          background: var(--arp-panel);
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
          display: flex;
          flex-direction: column;
          min-height: 0;
          flex: 1;
          padding: 1.05rem 1.15rem 1.25rem;
        }
        .arp-panel--empty { align-items: center; justify-content: center; }
        .arp-list .table tbody tr.is-selected,
        .arp-list .table tbody tr.is-selected td {
          background: #eff6ff;
        }
        .arp-list-count {
          flex-shrink: 0;
          margin: 0.4rem 0 0;
          color: var(--muted);
          font-size: 0.78rem;
        }

        .arp-empty-hero {
          text-align: center;
          max-width: 22rem;
          padding: 2rem 1rem;
          color: var(--arp-muted);
        }
        .arp-empty-hero svg {
          width: 42px;
          height: 42px;
          color: #94a3b8;
          margin-bottom: 0.75rem;
        }
        .arp-empty-hero h2 {
          margin: 0 0 0.4rem;
          color: var(--arp-ink);
          font-size: 1.1rem;
        }
        .arp-empty-hero p {
          margin: 0;
          font-size: 0.88rem;
          line-height: 1.45;
        }

        .arp-person-head { margin-bottom: 0.85rem; }
        .arp-person-title-row {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          flex-wrap: wrap;
          margin-bottom: 0.35rem;
        }
        .arp-eyebrow {
          margin: 0;
          color: var(--arp-muted);
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .arp-verified {
          display: inline-flex;
          align-items: center;
          gap: 0.28rem;
          font-size: 0.7rem;
          font-weight: 750;
          color: #166534;
          background: #dcfce7;
          border: 1px solid #86efac;
          border-radius: 999px;
          padding: 0.15rem 0.55rem;
        }
        .arp-verified svg { width: 12px; height: 12px; }
        .arp-person-main {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
          align-items: flex-start;
        }
        .arp-person-main h2 {
          margin: 0;
          font-size: 1.35rem;
          font-weight: 800;
          color: var(--arp-ink);
          letter-spacing: -0.02em;
        }
        .arp-person-line {
          margin: 0.3rem 0 0;
          color: var(--arp-muted);
          font-size: 0.88rem;
        }
        .arp-stats {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
        }
        .arp-stat {
          min-width: 4.4rem;
          border: 1px solid var(--arp-line);
          background: var(--arp-wash);
          border-radius: 12px;
          padding: 0.45rem 0.6rem;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.12s, background 0.12s, color 0.12s;
        }
        .arp-stat strong {
          display: block;
          font-size: 1.15rem;
          font-weight: 800;
          color: var(--arp-ink);
          line-height: 1.1;
        }
        .arp-stat span {
          font-size: 0.68rem;
          font-weight: 700;
          color: var(--arp-muted);
        }
        .arp-stat.is-active {
          background: var(--arp-blue);
          border-color: var(--arp-blue);
          box-shadow: 0 6px 14px rgba(37, 99, 235, 0.22);
        }
        .arp-stat.is-active strong,
        .arp-stat.is-active span { color: #fff; }

        .arp-meta-strip {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 0.45rem;
          margin: 0 0 1.1rem;
        }
        .arp-meta-cell {
          background: var(--arp-wash);
          border: 1px solid var(--arp-line);
          border-radius: 10px;
          padding: 0.55rem 0.65rem;
          min-width: 0;
        }
        .arp-meta-cell span {
          display: block;
          font-size: 0.65rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #94a3b8;
          margin-bottom: 0.2rem;
        }
        .arp-meta-cell strong {
          display: block;
          font-size: 0.84rem;
          font-weight: 700;
          color: var(--arp-ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .arp-section-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 0.75rem;
          flex-wrap: wrap;
          margin: 0.35rem 0 0.65rem;
        }
        .arp-section-head h3 {
          margin: 0;
          font-size: 0.98rem;
          font-weight: 800;
          color: var(--arp-ink);
          display: inline;
        }
        .arp-section-head > div {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          flex-wrap: wrap;
        }
        .arp-active-pill {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 0.12rem 0.5rem;
          font-size: 0.7rem;
          font-weight: 750;
          background: #dbeafe;
          color: #1d4ed8;
        }
        .arp-synced {
          margin: 0;
          color: var(--arp-muted);
          font-size: 0.76rem;
        }
        .arp-history-label {
          font-size: 0.75rem;
          color: var(--arp-muted);
          font-weight: 600;
        }
        .arp-section-head--history { margin-top: 1.25rem; }
        .arp-muted {
          margin: 0 0 0.85rem;
          color: var(--arp-muted);
          font-size: 0.88rem;
        }
        .arp-history-empty {
          display: flex;
          gap: 0.75rem;
          align-items: flex-start;
          border: 1px dashed #cbd5e1;
          border-radius: 12px;
          background: var(--arp-wash);
          padding: 1rem 1.05rem;
          color: var(--arp-muted);
        }
        .arp-history-empty svg {
          width: 22px;
          height: 22px;
          flex-shrink: 0;
          margin-top: 0.1rem;
          color: #94a3b8;
        }
        .arp-history-empty p {
          margin: 0;
          display: grid;
          gap: 0.2rem;
          font-size: 0.86rem;
          line-height: 1.4;
        }
        .arp-history-empty strong {
          color: var(--arp-ink);
          font-size: 0.9rem;
        }
        .arp-history-empty span { color: var(--arp-muted); }

        .arp-asset-table-wrap {
          overflow-x: auto;
          margin-bottom: 0.35rem;
          border: 1px solid var(--arp-line);
          border-radius: 12px;
        }
        .arp-asset-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.84rem;
        }
        .arp-asset-table th {
          text-align: left;
          font-size: 0.68rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #94a3b8;
          font-weight: 700;
          padding: 0.55rem 0.75rem;
          background: var(--arp-wash);
          border-bottom: 1px solid var(--arp-line);
        }
        .arp-asset-table td {
          padding: 0.7rem 0.75rem;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: middle;
        }
        .arp-asset-table tr:last-child td { border-bottom: none; }
        .arp-type-cell {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          font-weight: 650;
          color: #334155;
        }
        .arp-type-icon {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--arp-blue-soft);
          color: var(--arp-blue);
          flex-shrink: 0;
        }
        .arp-type-icon svg { width: 15px; height: 15px; }
        .arp-asset-tag {
          font-weight: 800;
          color: var(--arp-ink);
        }
        .arp-asset-co {
          display: block;
          color: var(--arp-muted);
          font-size: 0.72rem;
          margin-top: 0.1rem;
        }
        .arp-details-btn {
          border: none;
          background: transparent;
          color: var(--arp-blue);
          font-size: 0.82rem;
          font-weight: 700;
          cursor: pointer;
          padding: 0;
        }
        .arp-details-btn:hover { text-decoration: underline; }

        @media (max-width: 1100px) {
          .arp-meta-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        @media (max-width: 960px) {
          .arp-layout {
            grid-template-columns: 1fr;
            overflow: auto;
          }
          .arp-list, .arp-detail {
            min-height: 18rem;
            max-height: 55vh;
          }
          .arp-meta-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media print {
          .no-print, .sidebar, .app-footer, .mobile-menu-fab { display: none !important; }
          .arp-layout {
            grid-template-columns: 1fr;
            overflow: visible;
            display: block;
          }
          .arp-detail { overflow: visible; max-height: none; }
          .arp-panel { border: none; box-shadow: none; padding: 0; min-height: 0; }
          .arp-stat { box-shadow: none !important; }
        }
      `}</style>
    </main>
  );
}

function MetaCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="arp-meta-cell">
      <span>{label}</span>
      {typeof value === 'string' || typeof value === 'number' ? <strong>{value}</strong> : value}
    </div>
  );
}

function AssetTable({
  rows,
  showRole = false,
  onDetails,
}: {
  rows: AssetRow[];
  showRole?: boolean;
  onDetails?: (a: AssetRow) => void;
}) {
  return (
    <div className="arp-asset-table-wrap">
      <table className="arp-asset-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Asset ID</th>
            <th>Brand / Model</th>
            <th>Location</th>
            <th>Status</th>
            {showRole ? <th>Link</th> : null}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={`${a.category}-${a.id}-${a.role}-${a.matched_field}`}>
              <td>
                <span className="arp-type-cell">
                  <span className="arp-type-icon">{categoryIcon(a.category)}</span>
                  {categoryLabel(a.category)}
                </span>
              </td>
              <td>
                <span className="arp-asset-tag">{a.asset_tag}</span>
                {a.company_short ? (
                  <span className="arp-asset-co">{a.company_short}</span>
                ) : null}
              </td>
              <td>{[a.brand, a.model].filter(Boolean).join(' ') || '—'}</td>
              <td>{dash(a.location_name)}</td>
              <td>
                <StatusBadge status={String(a.status || 'unknown')} withIcon />
              </td>
              {showRole ? (
                <td>
                  <StatusBadge tone={roleTone(a.role)} label={roleLabel(a.role)} />
                </td>
              ) : null}
              <td>
                {onDetails ? (
                  <button type="button" className="arp-details-btn" onClick={() => onDetails(a)}>
                    Details
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function categoryIcon(category: string) {
  if (category === 'mobile_phone') return <IconPhone />;
  if (category === 'pc') return <IconPc />;
  if (category === 'other' || category === 'printer') return <IconBox />;
  return <IconLaptop />;
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden>
      <path d="m5 12 5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconUserSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="10" cy="8" r="3.2" />
      <path d="M4.5 18.5c.9-2.8 3.1-4.2 5.5-4.2 1.4 0 2.7.5 3.8 1.3" strokeLinecap="round" />
      <circle cx="17.5" cy="16.5" r="3" />
      <path d="m19.7 18.7 1.8 1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconLaptop() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="4" y="5" width="16" height="10" rx="1.5" />
      <path d="M2 17h20" strokeLinecap="round" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="8" y="3" width="8" height="18" rx="2" />
      <path d="M11 17h2" strokeLinecap="round" />
    </svg>
  );
}

function IconPc() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" strokeLinecap="round" />
    </svg>
  );
}

function IconBox() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5v-7Z" />
      <path d="M12 12v8M3 8.5l9 3.5 9-3.5" />
    </svg>
  );
}
