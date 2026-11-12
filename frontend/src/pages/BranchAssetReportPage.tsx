import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { LiveRepositoryBadge } from '../components/ui/PageHeader';
import StatusBadge, { assetStatusLabel } from '../components/ui/StatusBadge';
import AssetIcon from '../components/ui/AssetIcon';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import PaginationBar from '../components/ui/PaginationBar';
import TableSettingsMenu, { type PageSize } from '../components/ui/TableSettingsMenu';
import { api } from '../services/client';
import {
  getOrgMeta,
  type MetaCompany,
  type MetaDepartment,
  type MetaLocation,
} from '../services/metaCache';

const PAGE_SIZE_KEY = 'itams.reports.branchAssets.pageSize';

function readStoredPageSize(): PageSize {
  try {
    const raw = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (raw === 5 || raw === 10 || raw === 20 || raw === 50 || raw === 100 || raw === 500) return raw;
  } catch {
    /* ignore */
  }
  return 10;
}

type CompanyTab = 'IT' | 'IMS' | 'ISP';

type BranchRow = {
  location_id: number | null;
  location_name: string;
  company_code: string;
  company: string;
  total: number;
  by_category: Record<string, number>;
};

type AssetItem = {
  id: number;
  asset_tag: string;
  category: string;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  status?: string | null;
  pc_name?: string | null;
  allocated_person?: string | null;
  original_assigned_person?: string | null;
  company_code?: string | null;
  company?: string | null;
  location_name?: string | null;
  department_id?: number | null;
  department_name?: string | null;
};

const COMPANY_OPTIONS: { id: CompanyTab; label: string }[] = [
  { id: 'IT', label: 'ITL' },
  { id: 'IMS', label: 'IMS' },
  { id: 'ISP', label: 'ISP' },
];

const CATEGORY_CARDS: {
  key: string;
  label: string;
  tone: string;
  badge: string;
  badgeTone: string;
}[] = [
  { key: 'laptop', label: 'Laptops', tone: 'blue', badge: 'Active', badgeTone: 'green' },
  { key: 'mobile_phone', label: 'Mobile phones', tone: 'green', badge: 'SIM', badgeTone: 'blue' },
  { key: 'pc', label: 'PCs', tone: 'slate', badge: 'Fleet', badgeTone: 'slate' },
  { key: 'other', label: 'Other assets', tone: 'purple', badge: 'IT', badgeTone: 'purple' },
  { key: 'printer', label: 'Printers', tone: 'orange', badge: 'Print', badgeTone: 'orange' },
  { key: 'all', label: 'Total assets', tone: 'cyan', badge: 'Branch', badgeTone: 'cyan' },
];

const DEFAULT_BRANCH_CODES: Record<CompanyTab, string[]> = {
  IT: ['KANDY_HO'],
  IMS: ['BR_201'],
  ISP: ['KANDY'],
};

function dash(v: unknown): string {
  if (v == null || String(v).trim() === '') return '—';
  return String(v);
}

function catLabel(c: string): string {
  if (c === 'mobile_phone') return 'Mobile phone';
  if (c === 'laptop') return 'Laptop';
  if (c === 'pc') return 'PC';
  if (c === 'other') return 'Other';
  return c.replace(/_/g, ' ');
}

function assetPath(category: string): string {
  if (category === 'mobile_phone') return '/assets/mobile-phones';
  if (category === 'laptop') return '/assets/laptop';
  if (category === 'pc') return '/assets/all';
  if (category === 'other') return '/assets/others';
  return '/assets/all';
}

function holderName(r: AssetItem): string {
  return String(r.allocated_person || r.pc_name || r.original_assigned_person || '').trim();
}

function pickDefaultLocation(locs: MetaLocation[], companyCode: CompanyTab): string {
  const preferred = DEFAULT_BRANCH_CODES[companyCode] ?? [];
  for (const code of preferred) {
    const hit = locs.find((l) => String(l.code ?? '').toUpperCase() === code);
    if (hit) return String(hit.id);
  }
  const byName = locs.find((l) => /head\s*office.*kandy/i.test(l.name) || /^kandy$/i.test(l.name));
  if (byName) return String(byName.id);
  return locs[0] ? String(locs[0].id) : '';
}

export default function BranchAssetReportPage() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<MetaCompany[]>([]);
  const [locations, setLocations] = useState<MetaLocation[]>([]);
  const [departments, setDepartments] = useState<MetaDepartment[]>([]);
  const [company, setCompany] = useState<CompanyTab>('IT');
  const [locationId, setLocationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [locationReady, setLocationReady] = useState(false);
  const [q, setQ] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [branchMeta, setBranchMeta] = useState<BranchRow | null>(null);
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(() => readStoredPageSize());

  useEffect(() => {
    void getOrgMeta(true).then((m) => {
      setCompanies(m.companies.filter((c) => ['IT', 'IMS', 'ISP'].includes(c.code)));
      setLocations(m.locations);
      setDepartments(m.departments ?? []);
    });
  }, []);

  const companyId = useMemo(() => {
    const co = companies.find((c) => c.code === company);
    return co ? Number(co.id) : null;
  }, [companies, company]);

  const companyLocations = useMemo(() => {
    if (companyId == null) return [];
    return locations
      .filter((l) => Number(l.company_id) === companyId)
      .filter((l) => String(l.code ?? '').toUpperCase() !== 'CMB_BR')
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [locations, companyId]);

  const companyDepartments = useMemo(() => {
    if (companyId == null) return [];
    const lid = locationId ? Number(locationId) : null;
    return departments
      .filter((d) => Number(d.company_id) === companyId)
      .filter((d) => {
        if (lid == null || !Number.isFinite(lid)) return true;
        // Prefer departments tied to this branch; keep company-wide (no location) too
        if (d.location_id == null) return true;
        return Number(d.location_id) === lid;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [departments, companyId, locationId]);

  // Default branch: Head Office - Kandy (ITL) / company head office
  useEffect(() => {
    if (companyLocations.length === 0) return;
    const next = pickDefaultLocation(companyLocations, company);
    setLocationId(next);
    setDepartmentId('');
    setLocationReady(true);
    setCategoryFilter('all');
    setQ('');
  }, [company, companyLocations]);

  const selectedLocation = useMemo(
    () => companyLocations.find((l) => String(l.id) === locationId) ?? null,
    [companyLocations, locationId],
  );

  const load = useCallback(async () => {
    if (!locationReady || !locationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const summaryRes = await api<{ data: BranchRow[] }>(
        `/api/reports/branch-assets?company=${company}`,
      );
      const branches = summaryRes.data ?? [];
      const lid = Number(locationId);
      const meta =
        branches.find((b) => Number(b.location_id) === lid) ??
        ({
          location_id: lid,
          location_name: selectedLocation?.name ?? 'Branch',
          company_code: company,
          company: company === 'IT' ? 'ITL' : company,
          total: 0,
          by_category: {
            laptop: 0,
            mobile_phone: 0,
            pc: 0,
            other: 0,
            printer: 0,
          },
        } satisfies BranchRow);
      setBranchMeta(meta);

      const params = new URLSearchParams();
      params.set('location_id', locationId);
      params.set('company', company);
      if (departmentId) params.set('department_id', departmentId);
      const itemsRes = await api<{ data: AssetItem[] }>(
        `/api/reports/branch-assets/items?${params.toString()}`,
      );
      setItems(itemsRes.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load branch assets');
      setBranchMeta(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [company, locationId, departmentId, locationReady, selectedLocation?.name]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const fromMeta = branchMeta?.by_category ?? {};
    const laptop = Number(fromMeta.laptop ?? 0);
    const mobile = Number(fromMeta.mobile_phone ?? 0);
    const pc = Number(fromMeta.pc ?? 0);
    const other = Number(fromMeta.other ?? 0);
    const printer = Number(fromMeta.printer ?? 0);
    // Prefer live list counts when loaded so cards match the table
    if (items.length > 0 || departmentId) {
      const live: Record<string, number> = {
        laptop: 0,
        mobile_phone: 0,
        pc: 0,
        other: 0,
        printer: 0,
      };
      for (const r of items) {
        const k = String(r.category || 'other');
        live[k] = (live[k] ?? 0) + 1;
      }
      return {
        laptop: live.laptop,
        mobile_phone: live.mobile_phone,
        pc: live.pc,
        other: live.other,
        printer: live.printer,
        all: items.length,
      };
    }
    return {
      laptop,
      mobile_phone: mobile,
      pc,
      other,
      printer,
      all: laptop + mobile + pc + other + printer,
    };
  }, [branchMeta, items, departmentId]);

  const filteredItems = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((r) => {
      if (categoryFilter !== 'all' && String(r.category) !== categoryFilter) return false;
      if (!term) return true;
      return [
        r.asset_tag,
        r.brand,
        r.model,
        r.serial_number,
        r.pc_name,
        r.allocated_person,
        r.original_assigned_person,
        r.location_name,
        r.department_name,
        r.category,
      ].some((v) => String(v ?? '').toLowerCase().includes(term));
    });
  }, [items, categoryFilter, q]);

  useEffect(() => {
    setPage(1);
  }, [q, categoryFilter, locationId, departmentId, company, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, safePage, pageSize]);
  const rangeFrom = filteredItems.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeTo = Math.min(safePage * pageSize, filteredItems.length);

  function changePageSize(size: PageSize) {
    setPageSize(size);
    setPage(1);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      /* ignore */
    }
  }

  function openAsset(r: AssetItem) {
    const code = String(r.company_code ?? company).toUpperCase();
    const companyParam = code === 'ITL' ? 'IT' : code || 'IT';
    const params = new URLSearchParams();
    params.set('view', String(r.id));
    params.set('company', companyParam);
    params.set('returnTo', '/reports/branches');
    navigate(`${assetPath(String(r.category))}?${params.toString()}`);
  }

  return (
    <main className="page">
      <div className="no-print">
        <PageHeader
          eyebrow="Reports"
          title="Branch Asset Report"
          badge={<LiveRepositoryBadge />}
          subtitle="Pick a branch to see asset counts on cards, then open the matching list. Default branch is Head Office - Kandy."
        />

        <section className="card asset-filter-panel" style={{ marginBottom: '1rem' }}>
          <div
            className="asset-filter-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
          >
            <label className="asset-filter-field">
              <span className="asset-filter-label">Company</span>
              <select
                className="asset-filter-control"
                value={company}
                onChange={(e) => {
                  setLocationReady(false);
                  setCompany(e.target.value as CompanyTab);
                }}
              >
                {COMPANY_OPTIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="asset-filter-field">
              <span className="asset-filter-label">Branch / location</span>
              <select
                className="asset-filter-control"
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  setDepartmentId('');
                  setCategoryFilter('all');
                  setQ('');
                }}
              >
                {companyLocations.length === 0 ? (
                  <option value="">No locations</option>
                ) : (
                  companyLocations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="asset-filter-field">
              <span className="asset-filter-label">Department</span>
              <select
                className="asset-filter-control"
                value={departmentId}
                onChange={(e) => {
                  setDepartmentId(e.target.value);
                  setCategoryFilter('all');
                }}
              >
                <option value="">All departments</option>
                {companyDepartments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="asset-filter-field">
              <span className="asset-filter-label">Search</span>
              <input
                className="asset-filter-control"
                placeholder="Search tag, holder, brand, serial…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
          </div>
          <div className="asset-filter-actions" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="asset-filter-clear"
              disabled={!q && categoryFilter === 'all' && !departmentId}
              onClick={() => {
                setQ('');
                setCategoryFilter('all');
                setDepartmentId('');
              }}
            >
              Clear search / filters
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </section>
      </div>

      {loading ? <LoadingSkeleton rows={6} /> : null}
      {error ? <ErrorState description={error} onRetry={() => void load()} /> : null}

      {!loading && !error ? (
        <>
          <section className="branch-stat-row no-print" aria-label="Branch asset counts">
            {CATEGORY_CARDS.map((card) => {
              const value = counts[card.key] ?? 0;
              const active = categoryFilter === card.key;
              return (
                <button
                  key={card.key}
                  type="button"
                  className={`branch-stat-card tone-${card.tone}${active ? ' is-active' : ''}`}
                  onClick={() => setCategoryFilter(card.key)}
                  title={`Show ${card.label.toLowerCase()}`}
                >
                  <div className="branch-stat-top">
                    <span className="branch-stat-label">{card.label}</span>
                    <span className={`branch-stat-badge tone-${card.badgeTone}`}>{card.badge}</span>
                  </div>
                  <strong className="branch-stat-value">{value}</strong>
                  <span className="branch-stat-hint">
                    {selectedLocation?.name || 'Branch'} · click to list
                  </span>
                </button>
              );
            })}
          </section>

          <section className="card">
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
              <div>
                <h3 style={{ margin: 0 }}>
                  {selectedLocation?.name || 'Branch'} assets
                  {departmentId
                    ? (
                      <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: '0.95rem' }}>
                        {' '}
                        ·{' '}
                        {companyDepartments.find((d) => String(d.id) === departmentId)?.name ||
                          'Department'}
                      </span>
                      )
                    : null}
                  {categoryFilter !== 'all' ? (
                    <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: '0.95rem' }}>
                      {' '}
                      · {catLabel(categoryFilter)}
                    </span>
                  ) : null}
                </h3>
                <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
                  Filter by department above or click a card for type. Click a row to open the asset.
                </p>
              </div>
              <div className="asset-filter-actions" style={{ margin: 0 }}>
                <span style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>
                  {filteredItems.length === 0
                    ? '0 shown'
                    : `${rangeFrom}–${rangeTo} of ${filteredItems.length} shown`}
                  {items.length !== filteredItems.length ? ` · ${items.length} total` : ''}
                </span>
                <TableSettingsMenu
                  pageSize={pageSize}
                  onPageSizeChange={changePageSize}
                  onRefresh={() => void load()}
                  refreshing={loading}
                  rangeLabel={
                    filteredItems.length === 0
                      ? '0 of 0'
                      : `${rangeFrom} - ${rangeTo} of ${filteredItems.length}`
                  }
                />
                <PaginationBar
                  page={safePage}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  disabled={loading || filteredItems.length === 0}
                />
              </div>
            </div>

            {filteredItems.length === 0 ? (
              <EmptyState
                title="No assets for this branch filter"
                description="Try another category card, clear search, or pick a different branch."
              />
            ) : (
              <div className="table-wrap">
                <table className="table asset-data-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Asset ID</th>
                      <th>Name / holder</th>
                      <th>Department</th>
                      <th>Brand</th>
                      <th>S/N</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedItems.map((r) => (
                      <tr
                        key={`${r.category}-${r.id}`}
                        className="asset-row-click"
                        role="button"
                        tabIndex={0}
                        title="Open asset view"
                        onClick={() => openAsset(r)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openAsset(r);
                          }
                        }}
                      >
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <AssetIcon type={r.category} />
                            <span style={{ fontSize: '0.82rem', textTransform: 'capitalize' }}>
                              {catLabel(r.category)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <strong>{r.asset_tag}</strong>
                        </td>
                        <td>{dash(holderName(r))}</td>
                        <td>{dash(r.department_name)}</td>
                        <td>{dash(r.brand)}</td>
                        <td>{dash(r.serial_number)}</td>
                        <td>
                          <StatusBadge
                            status={String(r.status ?? '')}
                            label={assetStatusLabel(String(r.status ?? ''))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      <style>{`
        .branch-stat-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 0.75rem;
          margin-bottom: 1rem;
        }
        .branch-stat-card {
          text-align: left;
          border: 1px solid var(--border);
          border-bottom-width: 3px;
          border-radius: 12px;
          background: #fff;
          padding: 0.85rem 0.95rem;
          cursor: pointer;
          display: grid;
          gap: 0.35rem;
          min-height: 6.5rem;
        }
        .branch-stat-card.tone-blue { border-bottom-color: #2563eb; }
        .branch-stat-card.tone-green { border-bottom-color: #16a34a; }
        .branch-stat-card.tone-slate { border-bottom-color: #64748b; }
        .branch-stat-card.tone-purple { border-bottom-color: #7c3aed; }
        .branch-stat-card.tone-orange { border-bottom-color: #ea580c; }
        .branch-stat-card.tone-cyan { border-bottom-color: #0891b2; }
        .branch-stat-card.is-active {
          box-shadow: 0 0 0 2px #93c5fd;
          background: #f8fbff;
        }
        .branch-stat-card:hover { background: #f9fafb; }
        .branch-stat-top {
          display: flex;
          justify-content: space-between;
          gap: 0.5rem;
          align-items: flex-start;
        }
        .branch-stat-label {
          font-size: 0.68rem;
          font-weight: 750;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #6b7280;
        }
        .branch-stat-badge {
          font-size: 0.65rem;
          font-weight: 700;
          border-radius: 999px;
          padding: 0.12rem 0.45rem;
          white-space: nowrap;
        }
        .branch-stat-badge.tone-green { background: #dcfce7; color: #166534; }
        .branch-stat-badge.tone-blue { background: #dbeafe; color: #1d4ed8; }
        .branch-stat-badge.tone-slate { background: #f1f5f9; color: #475569; }
        .branch-stat-badge.tone-purple { background: #ede9fe; color: #6d28d9; }
        .branch-stat-badge.tone-orange { background: #ffedd5; color: #c2410c; }
        .branch-stat-badge.tone-cyan { background: #cffafe; color: #0e7490; }
        .branch-stat-value {
          font-size: 1.65rem;
          line-height: 1.1;
          color: #111827;
        }
        .branch-stat-hint {
          font-size: 0.72rem;
          color: #9ca3af;
        }
        @media print {
          .sidebar, .app-footer, .no-print, .mobile-menu-fab { display: none !important; }
        }
      `}</style>
    </main>
  );
}
