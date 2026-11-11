import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { LiveRepositoryBadge } from '../components/ui/PageHeader';
import StatusBadge from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import PaginationBar from '../components/ui/PaginationBar';
import TableSettingsMenu, { type PageSize } from '../components/ui/TableSettingsMenu';
import { api } from '../services/client';
import { getOrgMeta, type MetaCompany, type MetaLocation } from '../services/metaCache';

const PAGE_SIZE_KEY = 'itams.reports.maintenance.pageSize';

function readStoredPageSize(): PageSize {
  try {
    const raw = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (raw === 5 || raw === 10 || raw === 20 || raw === 50 || raw === 100 || raw === 500) return raw;
  } catch {
    /* ignore */
  }
  return 10;
}

type MaintRow = {
  id: number;
  asset_tag: string;
  category?: string | null;
  category_label?: string | null;
  pc_name?: string | null;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  cpu?: string | null;
  ram_gb?: number | string | null;
  storage_gb?: number | string | null;
  windows_version?: string | null;
  status?: string | null;
  warranty_expires_on?: string | null;
  warranty_period?: string | null;
  allocated_person?: string | null;
  original_assigned_person?: string | null;
  company_code?: string | null;
  company?: string | null;
  location_name?: string | null;
};

type AssetCategoryFilter = '' | 'all' | 'pc' | 'laptop' | 'mobile_phone' | 'other';
type WarrantyFilter = '' | 'in' | 'expired' | 'expiring' | 'none';

const WINDOWS_PRESETS = ['Windows 11', 'Windows 10', 'Windows 8', 'Windows 7'] as const;

function dash(v: unknown): string {
  if (v == null || String(v).trim() === '') return '—';
  return String(v);
}

function statusTone(status: string): 'available' | 'assigned' | 'repair' | 'lost' | 'disposed' | 'info' {
  const s = status.toLowerCase();
  if (s === 'available') return 'available';
  if (s === 'deployed') return 'assigned';
  if (s === 'under_repair') return 'repair';
  if (s === 'lost') return 'lost';
  if (s === 'disposed') return 'disposed';
  return 'info';
}

function statusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === 'deployed') return 'Assigned';
  if (s === 'under_repair') return 'Under repair';
  if (s === 'lost') return 'Lost / stolen';
  return status.replace(/_/g, ' ');
}

function warrantyTone(expires: string | null | undefined): 'available' | 'repair' | 'lost' | 'info' {
  if (!expires) return 'info';
  const d = String(expires).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (d < today) return 'lost';
  const limit = new Date();
  limit.setDate(limit.getDate() + 90);
  if (d <= limit.toISOString().slice(0, 10)) return 'repair';
  return 'available';
}

function warrantyLabel(expires: string | null | undefined): string {
  if (!expires) return 'No date';
  const d = String(expires).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (d < today) return `Expired ${d}`;
  const limit = new Date();
  limit.setDate(limit.getDate() + 90);
  if (d <= limit.toISOString().slice(0, 10)) return `Expires ${d}`;
  return `Valid to ${d}`;
}

function categoryPath(category: string): string {
  if (category === 'mobile_phone') return '/assets/mobile-phones';
  if (category === 'laptop') return '/assets/laptop';
  if (category === 'other') return '/assets/others';
  return '/assets/all';
}

function formatRam(v: unknown): string {
  if (v == null || String(v).trim() === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return `${n % 1 === 0 ? String(n) : String(n)} GB`;
}

function companyLabel(code?: string | null, name?: string | null): string {
  const c = String(code ?? '').toUpperCase();
  if (c === 'IT' || c === 'ITL') return 'ITL';
  if (c === 'IMS' || c === 'ISP') return c;
  return String(name || code || 'Unassigned company');
}

type BranchGroup = { location: string; rows: MaintRow[] };
type CompanyGroup = { companyKey: string; companyTitle: string; branches: BranchGroup[]; total: number };

function groupByCompanyAndBranch(items: MaintRow[]): CompanyGroup[] {
  const companyMap = new Map<string, { title: string; branchMap: Map<string, MaintRow[]> }>();
  for (const r of items) {
    const key = String(r.company_code ?? '').toUpperCase() || 'UNKNOWN';
    const title = companyLabel(r.company_code, r.company);
    if (!companyMap.has(key)) {
      companyMap.set(key, { title, branchMap: new Map() });
    }
    const co = companyMap.get(key)!;
    const loc = String(r.location_name ?? '').trim() || 'No branch / location';
    if (!co.branchMap.has(loc)) co.branchMap.set(loc, []);
    co.branchMap.get(loc)!.push(r);
  }

  const order = ['IT', 'ITL', 'IMS', 'ISP'];
  return Array.from(companyMap.entries())
    .sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      return a.localeCompare(b);
    })
    .map(([companyKey, { title, branchMap }]) => {
      const branches = Array.from(branchMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([location, branchRows]) => ({
          location,
          rows: [...branchRows].sort((x, y) =>
            String(x.asset_tag ?? '').localeCompare(String(y.asset_tag ?? '')),
          ),
        }));
      return {
        companyKey,
        companyTitle: title,
        branches,
        total: branches.reduce((n, b) => n + b.rows.length, 0),
      };
    });
}

export default function MaintenanceReportsPage() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<MetaCompany[]>([]);
  const [locations, setLocations] = useState<MetaLocation[]>([]);
  const [company, setCompany] = useState('ALL');
  const [locationId, setLocationId] = useState('');
  const [category, setCategory] = useState<AssetCategoryFilter>('');
  const [warranty, setWarranty] = useState<WarrantyFilter>('');
  const [cpu, setCpu] = useState('');
  const [windows, setWindows] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<MaintRow[]>([]);
  const [processors, setProcessors] = useState<string[]>([]);
  const [windowsVersions, setWindowsVersions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(() => readStoredPageSize());
  const [viewMode, setViewMode] = useState<'list' | 'report'>('list');
  const [reportGeneratedAt, setReportGeneratedAt] = useState<Date | null>(null);

  /** Empty asset-type control means Desktop PCs — never widen to all types for warranty. */
  const effectiveCategory: AssetCategoryFilter = category === '' ? 'pc' : category;
  const showPcFilters =
    effectiveCategory === 'pc' || effectiveCategory === 'all' || effectiveCategory === 'laptop';

  useEffect(() => {
    void getOrgMeta().then((m) => {
      setCompanies(m.companies.filter((c) => c.code !== 'FOTON'));
      setLocations(m.locations);
    });
  }, []);

  const companyLocations = useMemo(() => {
    if (company === 'ALL') return locations;
    const co = companies.find((c) => c.code === (company === 'ITL' ? 'IT' : company));
    if (!co) return locations;
    return locations.filter((l) => Number(l.company_id) === Number(co.id));
  }, [locations, companies, company]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (company && company !== 'ALL') params.set('company', company);
      if (locationId) params.set('location_id', locationId);
      params.set('category', effectiveCategory);
      if (warranty) params.set('warranty', warranty);
      if (cpu.trim() && showPcFilters) params.set('cpu', cpu.trim());
      if (windows.trim() && (effectiveCategory === 'pc' || effectiveCategory === 'all')) {
        params.set('windows_version', windows.trim());
      }
      if (status) params.set('status', status);
      if (q.trim()) params.set('q', q.trim());
      const res = await api<{
        data: MaintRow[];
        meta?: { processors?: string[]; windows_versions?: string[]; total?: number };
      }>(`/api/reports/pc-specs?${params.toString()}`);
      setRows(res.data ?? []);
      if (res.meta?.processors?.length) setProcessors(res.meta.processors);
      if (res.meta?.windows_versions?.length) setWindowsVersions(res.meta.windows_versions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load maintenance report');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setViewMode('list');
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, locationId, category, warranty, cpu, windows, status]);

  const windowsOptions = useMemo(() => {
    const set = new Set<string>([...WINDOWS_PRESETS, ...windowsVersions]);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [windowsVersions]);

  useEffect(() => {
    setPage(1);
  }, [company, locationId, category, warranty, cpu, windows, status, q, pageSize, rows.length]);

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

  function openAssetView(r: MaintRow) {
    const code = String(r.company_code ?? '').toUpperCase();
    const companyParam = code === 'ITL' ? 'IT' : code || 'IT';
    const cat = String(r.category ?? 'pc');
    const params = new URLSearchParams();
    params.set('view', String(r.id));
    params.set('company', companyParam);
    params.set('returnTo', '/reports/maintenance');
    navigate(`${categoryPath(cat)}?${params.toString()}`);
  }

  const filtersDirty =
    !!q ||
    !!cpu ||
    !!windows ||
    !!status ||
    !!locationId ||
    !!warranty ||
    !!category ||
    company !== 'ALL';

  const reportGroups = useMemo(() => groupByCompanyAndBranch(rows), [rows]);

  const activeFilterLabels = useMemo(() => {
    const bits: string[] = [];
    if (company !== 'ALL') bits.push(`Company: ${company === 'IT' ? 'ITL' : company}`);
    else bits.push('Company: All');
    if (locationId) {
      const loc = companyLocations.find((l) => String(l.id) === locationId);
      bits.push(`Branch: ${loc?.name || locationId}`);
    } else bits.push('Branch: All');
    if (!category) bits.push('Type: Desktop PCs');
    else if (category === 'all') bits.push('Type: All assets');
    else if (category === 'pc') bits.push('Type: Desktop PC');
    else if (category === 'laptop') bits.push('Type: Laptop');
    else if (category === 'mobile_phone') bits.push('Type: Mobile phone');
    else if (category === 'other') bits.push('Type: Other assets');
    if (warranty === 'in') bits.push('Warranty: In warranty');
    if (warranty === 'expired') bits.push('Warranty: Expired');
    if (warranty === 'expiring') bits.push('Warranty: Expiring ≤90 days');
    if (warranty === 'none') bits.push('Warranty: No date');
    if (cpu.trim()) bits.push(`Processor: ${cpu.trim()}`);
    if (windows.trim()) bits.push(`Windows: ${windows.trim()}`);
    if (status === 'available') bits.push('Status: Available');
    if (status === 'deployed') bits.push('Status: Assigned');
    if (status === 'under_repair') bits.push('Status: Under repair');
    if (status === 'lost') bits.push('Status: Lost / stolen');
    if (q.trim()) bits.push(`Search: “${q.trim()}”`);
    return bits;
  }, [company, locationId, category, warranty, cpu, windows, status, q, companyLocations]);

  function openReport() {
    setReportGeneratedAt(new Date());
    setViewMode('report');
    window.setTimeout(() => {
      document.getElementById('maint-report-doc')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 40);
  }

  function printMaintReport() {
    const article = document.querySelector('.maint-report-doc');
    if (!article) return;

    const win = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=800');
    if (!win) {
      window.print();
      return;
    }

    const copiedStyles = Array.from(
      document.querySelectorAll('style, link[rel="stylesheet"]'),
    )
      .map((node) => node.outerHTML)
      .join('\n');

    win.document.open();
    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Maintenance Report</title>
  ${copiedStyles}
  <style>
    @page { size: auto; margin: 12mm; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff !important;
      color: #0f172a;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }
    .no-print { display: none !important; }
    .maint-report-doc {
      border: none !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      padding: 0 !important;
    }
    .maint-report-company {
      break-inside: auto;
      page-break-inside: auto;
    }
    .maint-report-table {
      table-layout: fixed !important;
      width: 100% !important;
    }
    .maint-report-table tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .maint-report-branch-row {
      break-after: avoid;
      page-break-after: avoid;
    }
    .table-wrap { overflow: visible !important; }
  </style>
</head>
<body>${article.outerHTML}</body>
</html>`);
    win.document.close();

    const triggerPrint = () => {
      try {
        win.focus();
        win.print();
      } catch {
        /* ignore */
      }
    };

    if (win.document.readyState === 'complete') {
      window.setTimeout(triggerPrint, 150);
    } else {
      win.onload = () => window.setTimeout(triggerPrint, 150);
    }
  }

  return (
    <main className="page maint-page">
      <div className="no-print">
        <PageHeader
          eyebrow="Reports"
          title="Maintenance Report"
          badge={<LiveRepositoryBadge />}
          subtitle="Filter inventory by warranty, asset type, processor, and Windows — then generate a company / branch report."
          actions={
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading || !!error || rows.length === 0}
              onClick={openReport}
            >
              Generate report
            </button>
          }
        />

        <section className="card asset-filter-panel" style={{ marginBottom: '1rem' }}>
          <div
            className="asset-filter-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
          >
            <label className="asset-filter-field">
              <span className="asset-filter-label">Company</span>
              <select
                className="asset-filter-control"
                value={company}
                onChange={(e) => {
                  setCompany(e.target.value);
                  setLocationId('');
                }}
              >
                <option value="ALL">All companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.code === 'IT' ? 'ITL' : c.short_name || c.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="asset-filter-field">
              <span className="asset-filter-label">Branch / location</span>
              <select
                className="asset-filter-control"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">All locations</option>
                {companyLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="asset-filter-field">
              <span className="asset-filter-label">Asset type</span>
              <select
                className="asset-filter-control"
                value={category}
                onChange={(e) => setCategory(e.target.value as AssetCategoryFilter)}
              >
                <option value="">Desktop PCs (default)</option>
                <option value="all">All asset types</option>
                <option value="pc">Desktop PC</option>
                <option value="laptop">Laptop</option>
                <option value="mobile_phone">Mobile phone</option>
                <option value="other">Other assets</option>
              </select>
            </label>
            <label className="asset-filter-field">
              <span className="asset-filter-label">Warranty</span>
              <select
                className="asset-filter-control"
                value={warranty}
                onChange={(e) => setWarranty(e.target.value as WarrantyFilter)}
              >
                <option value="">All warranties</option>
                <option value="in">In warranty</option>
                <option value="expiring">Expiring (90 days)</option>
                <option value="expired">Expired</option>
                <option value="none">No warranty date</option>
              </select>
            </label>
            {showPcFilters ? (
              <label className="asset-filter-field">
                <span className="asset-filter-label">Processor</span>
                <input
                  className="asset-filter-control"
                  list="maint-cpu-list"
                  placeholder="e.g. i5, Ryzen, Core"
                  value={cpu}
                  onChange={(e) => setCpu(e.target.value)}
                />
                <datalist id="maint-cpu-list">
                  {processors.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </label>
            ) : null}
            {category === '' || category === 'pc' || category === 'all' ? (
              <label className="asset-filter-field">
                <span className="asset-filter-label">Windows version</span>
                <select
                  className="asset-filter-control"
                  value={windows}
                  onChange={(e) => setWindows(e.target.value)}
                >
                  <option value="">All versions</option>
                  {windowsOptions.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="asset-filter-field">
              <span className="asset-filter-label">Status</span>
              <select
                className="asset-filter-control"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                <option value="available">Available</option>
                <option value="deployed">Assigned</option>
                <option value="under_repair">Under repair</option>
                <option value="lost">Lost / stolen</option>
              </select>
            </label>
            <label className="asset-filter-field">
              <span className="asset-filter-label">Search</span>
              <input
                className="asset-filter-control"
                placeholder="Tag, name, serial…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void load();
                }}
              />
            </label>
          </div>
          <div className="asset-filter-actions" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="asset-filter-clear"
              disabled={!filtersDirty}
              onClick={() => {
                setCompany('ALL');
                setLocationId('');
                setCategory('');
                setWarranty('');
                setCpu('');
                setWindows('');
                setStatus('');
                setQ('');
              }}
            >
              Clear filters
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void load()}>
              Apply
            </button>
          </div>
        </section>
      </div>

      {loading ? <LoadingSkeleton rows={8} /> : null}
      {error ? <ErrorState description={error} onRetry={() => void load()} /> : null}

      {!loading && !error && viewMode === 'list' ? (
        <section className="card no-print">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '0.75rem',
              flexWrap: 'wrap',
              marginBottom: '0.85rem',
              alignItems: 'baseline',
            }}
          >
            <h3 style={{ margin: 0 }}>
              {effectiveCategory === 'all'
                ? 'Matching assets'
                : effectiveCategory === 'pc'
                  ? 'Matching PCs'
                  : effectiveCategory === 'laptop'
                    ? 'Matching laptops'
                    : effectiveCategory === 'mobile_phone'
                      ? 'Matching mobile phones'
                      : 'Matching other assets'}
            </h3>
            <div className="asset-filter-actions" style={{ margin: 0 }}>
              <span style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>
                {rows.length === 0
                  ? '0 results'
                  : `${rangeFrom}–${rangeTo} of ${rows.length} result${rows.length === 1 ? '' : 's'}`}
                {warranty === 'in' ? ' · in warranty' : ''}
                {warranty === 'expired' ? ' · expired' : ''}
                {warranty === 'expiring' ? ' · expiring ≤90 days' : ''}
                {warranty === 'none' ? ' · no warranty date' : ''}
                {cpu.trim() ? ` · processor “${cpu.trim()}”` : ''}
                {windows.trim() ? ` · ${windows.trim()}` : ''}
              </span>
              <TableSettingsMenu
                pageSize={pageSize}
                onPageSizeChange={changePageSize}
                onRefresh={() => void load()}
                refreshing={loading}
                rangeLabel={rows.length === 0 ? '0 of 0' : `${rangeFrom} - ${rangeTo} of ${rows.length}`}
              />
              <PaginationBar
                page={safePage}
                totalPages={totalPages}
                onPageChange={setPage}
                disabled={loading || rows.length === 0}
              />
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="No assets match these filters"
              description="Try another warranty status, asset type, processor, or clear filters."
            />
          ) : (
            <div className="table-wrap">
              <table className="table asset-data-table">
                <thead>
                  <tr>
                    <th>Asset ID</th>
                    <th>Type</th>
                    <th>Name / holder</th>
                    <th>Company</th>
                    <th>Location</th>
                    <th>Processor</th>
                    <th>RAM</th>
                    <th>Windows</th>
                    <th>Warranty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((r) => (
                    <tr
                      key={`${r.category ?? 'pc'}-${r.id}`}
                      className="asset-row-click"
                      role="button"
                      tabIndex={0}
                      title="Open asset view"
                      onClick={() => openAssetView(r)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openAssetView(r);
                        }
                      }}
                    >
                      <td>
                        <strong>{r.asset_tag}</strong>
                      </td>
                      <td>{dash(r.category_label || r.category || 'Desktop PC')}</td>
                      <td>{dash(r.allocated_person || r.pc_name || r.original_assigned_person)}</td>
                      <td>{dash(r.company_code === 'IT' ? 'ITL' : r.company || r.company_code)}</td>
                      <td>{dash(r.location_name)}</td>
                      <td>{dash(r.cpu)}</td>
                      <td>{formatRam(r.ram_gb)}</td>
                      <td>{dash(r.windows_version)}</td>
                      <td>
                        <StatusBadge
                          label={warrantyLabel(r.warranty_expires_on)}
                          tone={warrantyTone(r.warranty_expires_on)}
                        />
                      </td>
                      <td>
                        <StatusBadge
                          label={statusLabel(String(r.status ?? ''))}
                          tone={statusTone(String(r.status ?? ''))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {!loading && !error && viewMode === 'report' ? (
        <section className="maint-report" id="maint-report-doc">
          <div className="maint-report-toolbar no-print">
            <button type="button" className="btn btn-soft" onClick={() => setViewMode('list')}>
              ← Back to results
            </button>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={printMaintReport}>
                Print / PDF
              </button>
            </div>
          </div>

          <article className="maint-report-doc">
            <header className="maint-report-head">
              <div>
                <p className="maint-report-kicker">Indra Group · IT Asset Management</p>
                <h2>Maintenance Report</h2>
                <p className="maint-report-meta">
                  Generated{' '}
                  {(reportGeneratedAt ?? new Date()).toLocaleString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' · '}
                  {rows.length} asset{rows.length === 1 ? '' : 's'}
                  {' · '}
                  {reportGroups.length} compan{reportGroups.length === 1 ? 'y' : 'ies'}
                </p>
              </div>
            </header>

            <div className="maint-report-filters">
              <h3>Applied filters</h3>
              <ul>
                {activeFilterLabels.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </div>

            {rows.length === 0 ? (
              <EmptyState
                title="No assets for this report"
                description="Adjust filters and generate again."
              />
            ) : (
              reportGroups.map((co) => (
                <section key={co.companyKey} className="maint-report-company">
                  <div className="maint-report-company-head">
                    <h3>{co.companyTitle}</h3>
                    <span>
                      {co.total} asset{co.total === 1 ? '' : 's'} · {co.branches.length} branch
                      {co.branches.length === 1 ? '' : 'es'}
                    </span>
                  </div>

                  <div className="table-wrap">
                    <table className="table maint-report-table">
                      <colgroup>
                        <col className="col-asset" />
                        <col className="col-type" />
                        <col className="col-holder" />
                        <col className="col-cpu" />
                        <col className="col-ram" />
                        <col className="col-win" />
                        <col className="col-warranty" />
                        <col className="col-status" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Asset ID</th>
                          <th>Type</th>
                          <th>Name / holder</th>
                          <th>Processor</th>
                          <th>RAM</th>
                          <th>Windows</th>
                          <th>Warranty</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {co.branches.map((br) => (
                          <Fragment key={`${co.companyKey}-${br.location}`}>
                            <tr className="maint-report-branch-row">
                              <td colSpan={8}>
                                <div className="maint-report-branch-head">
                                  <h4>{br.location}</h4>
                                  <span>
                                    {br.rows.length} item{br.rows.length === 1 ? '' : 's'}
                                  </span>
                                </div>
                              </td>
                            </tr>
                            {br.rows.map((r) => (
                              <tr key={`${r.category ?? 'pc'}-${r.id}`}>
                                <td>
                                  <strong>{r.asset_tag}</strong>
                                </td>
                                <td>{dash(r.category_label || r.category || 'Desktop PC')}</td>
                                <td>
                                  {dash(
                                    r.allocated_person ||
                                      r.pc_name ||
                                      r.original_assigned_person,
                                  )}
                                </td>
                                <td>{dash(r.cpu)}</td>
                                <td>{formatRam(r.ram_gb)}</td>
                                <td>{dash(r.windows_version)}</td>
                                <td>{warrantyLabel(r.warranty_expires_on)}</td>
                                <td>{statusLabel(String(r.status ?? ''))}</td>
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))
            )}

            {rows.length > 0 ? (
              <footer className="maint-report-foot">
                <div>
                  <strong>Report total</strong>
                  <span>
                    {rows.length} asset{rows.length === 1 ? '' : 's'} across {reportGroups.length}{' '}
                    compan{reportGroups.length === 1 ? 'y' : 'ies'}
                  </span>
                </div>
                <div className="maint-report-summary-grid">
                  {reportGroups.map((co) => (
                    <div key={`sum-${co.companyKey}`}>
                      <strong>{co.companyTitle}</strong>
                      <span>{co.total}</span>
                    </div>
                  ))}
                </div>
              </footer>
            ) : null}
          </article>
        </section>
      ) : null}

      <style>{`
        .asset-row-click { cursor: pointer; }
        .asset-row-click:hover { background: #f8fafc; }
        .maint-report-toolbar {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
          margin-bottom: 0.85rem;
        }
        .maint-report-doc {
          border: 1px solid var(--border);
          border-radius: 14px;
          background: #fff;
          padding: 1.25rem 1.35rem 1.5rem;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
        }
        .maint-report-head h2 {
          margin: 0.15rem 0 0.35rem;
          font-size: 1.45rem;
          letter-spacing: -0.02em;
        }
        .maint-report-kicker {
          margin: 0;
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #2563eb;
        }
        .maint-report-meta {
          margin: 0;
          color: var(--muted);
          font-size: 0.88rem;
        }
        .maint-report-filters {
          margin: 1rem 0 1.25rem;
          padding: 0.85rem 1rem;
          border-radius: 12px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }
        .maint-report-filters h3 {
          margin: 0 0 0.45rem;
          font-size: 0.82rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #64748b;
        }
        .maint-report-filters ul {
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
        }
        .maint-report-filters li {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 999px;
          padding: 0.22rem 0.65rem;
          font-size: 0.78rem;
          font-weight: 650;
          color: #334155;
        }
        .maint-report-company {
          margin-top: 1.35rem;
        }
        .maint-report-company-head {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          align-items: baseline;
          flex-wrap: wrap;
          padding-bottom: 0.45rem;
          border-bottom: 2px solid #0f172a;
          margin-bottom: 0.85rem;
        }
        .maint-report-company-head h3 {
          margin: 0;
          font-size: 1.15rem;
        }
        .maint-report-company-head span,
        .maint-report-branch-head span {
          color: var(--muted);
          font-size: 0.84rem;
          font-weight: 650;
        }
        .maint-report-table {
          table-layout: fixed;
          width: 100%;
          border-collapse: collapse;
        }
        .maint-report-table col.col-asset { width: 12%; }
        .maint-report-table col.col-type { width: 11%; }
        .maint-report-table col.col-holder { width: 16%; }
        .maint-report-table col.col-cpu { width: 15%; }
        .maint-report-table col.col-ram { width: 7%; }
        .maint-report-table col.col-win { width: 13%; }
        .maint-report-table col.col-warranty { width: 13%; }
        .maint-report-table col.col-status { width: 13%; }
        .maint-report-table th,
        .maint-report-table td {
          padding: 0.45rem 0.5rem;
          vertical-align: middle;
          text-align: left;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .maint-report-table th {
          font-size: 0.72rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #64748b;
          background: #f8fafc;
        }
        .maint-report-branch-row td {
          padding: 0.85rem 0.5rem 0.35rem;
          border-bottom: none;
          background: transparent;
        }
        .maint-report-branch-row:first-child td {
          padding-top: 0.35rem;
        }
        .maint-report-branch-head {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          align-items: baseline;
          flex-wrap: wrap;
        }
        .maint-report-branch-head h4 {
          margin: 0;
          font-size: 0.95rem;
          color: #1e293b;
          text-transform: none;
          letter-spacing: normal;
          font-weight: 700;
        }
        .maint-report-foot {
          margin-top: 1.5rem;
          padding-top: 1rem;
          border-top: 1px solid var(--border);
          display: grid;
          gap: 0.85rem;
        }
        .maint-report-foot > div:first-child {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .maint-report-summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
          gap: 0.5rem;
        }
        .maint-report-summary-grid > div {
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          background: #f8fafc;
          padding: 0.55rem 0.7rem;
          display: flex;
          justify-content: space-between;
          gap: 0.5rem;
          font-size: 0.86rem;
        }
        @media print {
          /* App shell clips to viewport — unlock so multi-page PDF works */
          html, body, #root {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
          }
          .app-shell,
          .main-content,
          .main-panel,
          .page,
          .maint-page,
          .maint-report {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            display: block !important;
            flex: none !important;
          }
          .sidebar,
          .app-footer,
          .no-print,
          .mobile-menu-fab,
          .header-bar,
          .topbar,
          .pagination-bar,
          .table-settings {
            display: none !important;
          }
          .page {
            padding: 0 !important;
            max-width: none !important;
            animation: none !important;
          }
          .maint-report-doc {
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
          }
          /* Allow large company sections to span pages; keep rows together */
          .maint-report-company {
            break-inside: auto;
            page-break-inside: auto;
          }
          .maint-report-table {
            table-layout: fixed !important;
            width: 100% !important;
          }
          .maint-report-table tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .maint-report-company-head,
          .maint-report-branch-row {
            break-after: avoid;
            page-break-after: avoid;
          }
          .asset-row-click:hover { background: transparent; }
        }
      `}</style>
    </main>
  );
}
