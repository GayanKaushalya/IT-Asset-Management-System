import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { LiveRepositoryBadge } from '../components/ui/PageHeader';
import StatusBadge, { assetStatusLabel } from '../components/ui/StatusBadge';
import AssetIcon from '../components/ui/AssetIcon';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import PaginationBar from '../components/ui/PaginationBar';
import TableSettingsMenu, { type PageSize } from '../components/ui/TableSettingsMenu';
import { api } from '../services/client';
import { getOrgMeta, type MetaCompany, type MetaLocation } from '../services/metaCache';

const PAGE_SIZE_KEY = 'itams.reports.stock.pageSize';

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
type StockKind = 'all' | 'new' | 'old';

type StockItem = {
  id: number;
  asset_tag: string;
  category: string;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  item_name?: string | null;
  status?: string | null;
  holder_name?: string | null;
  is_legacy?: boolean;
  stock_kind?: string;
  company_code?: string | null;
  company?: string | null;
  location_name?: string | null;
  location_id?: number | null;
};

const COMPANY_TABS: { id: CompanyTab; label: string }[] = [
  { id: 'IT', label: 'ITL' },
  { id: 'IMS', label: 'IMS' },
  { id: 'ISP', label: 'ISP' },
];

const HEAD_OFFICE_CODES: Record<CompanyTab, string[]> = {
  IT: ['KANDY_HO'],
  IMS: ['BR_201'],
  ISP: ['KANDY'],
};

const CATEGORY_CARDS: { key: string; label: string; tone: string }[] = [
  { key: 'all', label: 'All available', tone: 'cyan' },
  { key: 'laptop', label: 'Laptops', tone: 'blue' },
  { key: 'mobile_phone', label: 'Mobile phones', tone: 'green' },
  { key: 'pc', label: 'PCs', tone: 'slate' },
  { key: 'other', label: 'Other assets', tone: 'purple' },
];

const STATUS_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'deployed', label: 'Deployed' },
  { value: 'in_repair', label: 'In repair' },
  { value: 'retired', label: 'Retired' },
  { value: 'disposed', label: 'Disposed' },
];

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

function headOfficeLocationId(
  companyTab: CompanyTab,
  companyLocations: MetaLocation[],
): string {
  const preferred = HEAD_OFFICE_CODES[companyTab] ?? [];
  for (const code of preferred) {
    const hit = companyLocations.find((l) => String(l.code ?? '').toUpperCase() === code);
    if (hit) return String(hit.id);
  }
  const byName = companyLocations.find(
    (l) => /head\s*office/i.test(l.name) && /kandy/i.test(l.name),
  );
  if (byName) return String(byName.id);
  return companyLocations[0] ? String(companyLocations[0].id) : '';
}

export default function StockReportPage() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<MetaCompany[]>([]);
  const [locations, setLocations] = useState<MetaLocation[]>([]);
  const [company, setCompany] = useState<CompanyTab>('IT');
  const [locationId, setLocationId] = useState('');
  const [locationReady, setLocationReady] = useState(false);
  const [statusFilter, setStatusFilter] = useState('available');
  const [stockKind, setStockKind] = useState<StockKind>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [q, setQ] = useState('');

  const [items, setItems] = useState<StockItem[]>([]);
  const [meta, setMeta] = useState<{
    total: number;
    new_count: number;
    old_count: number;
    by_category: Record<string, number>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(() => readStoredPageSize());

  useEffect(() => {
    void getOrgMeta(true).then((m) => {
      setCompanies(m.companies.filter((c) => ['IT', 'IMS', 'ISP'].includes(c.code)));
      setLocations(m.locations);
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

  useEffect(() => {
    if (companyLocations.length === 0) return;
    setLocationId(headOfficeLocationId(company, companyLocations));
    setLocationReady(true);
    setCategoryFilter('all');
    setQ('');
    setStockKind('all');
    setStatusFilter('available');
  }, [company, companyLocations]);

  const selectedLocationName = useMemo(() => {
    if (!locationId) return 'All locations';
    return companyLocations.find((l) => String(l.id) === locationId)?.name ?? 'Branch';
  }, [companyLocations, locationId]);

  const load = useCallback(async () => {
    if (!locationReady) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('company', company);
      params.set('status', statusFilter || 'available');
      params.set('stock', stockKind);
      if (locationId) params.set('location_id', locationId);

      const res = await api<{
        data: StockItem[];
        meta: {
          total: number;
          new_count: number;
          old_count: number;
          by_category: Record<string, number>;
        };
      }>(`/api/reports/stock?${params.toString()}`);
      setItems(res.data ?? []);
      setMeta(res.meta ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stock report');
      setItems([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [company, locationId, locationReady, statusFilter, stockKind]);

  useEffect(() => {
    void load();
  }, [load]);

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
        r.item_name,
        r.holder_name,
        r.location_name,
        r.category,
        r.stock_kind,
      ].some((v) => String(v ?? '').toLowerCase().includes(term));
    });
  }, [items, categoryFilter, q]);

  const counts = useMemo(() => {
    // Prefer live list counts so cards match the table after client filters
    if (items.length > 0 || meta == null) {
      const live: Record<string, number> = {
        laptop: 0,
        mobile_phone: 0,
        pc: 0,
        other: 0,
      };
      let newCount = 0;
      let oldCount = 0;
      for (const r of items) {
        const k = String(r.category || 'other');
        live[k] = (live[k] ?? 0) + 1;
        if (r.is_legacy || r.stock_kind === 'old') oldCount += 1;
        else newCount += 1;
      }
      return {
        all: items.length,
        laptop: live.laptop,
        mobile_phone: live.mobile_phone,
        pc: live.pc,
        other: live.other,
        new_count: newCount,
        old_count: oldCount,
      };
    }
    const by = meta.by_category ?? {};
    return {
      all: meta.total ?? 0,
      laptop: Number(by.laptop ?? 0),
      mobile_phone: Number(by.mobile_phone ?? 0),
      pc: Number(by.pc ?? 0),
      other: Number(by.other ?? 0),
      new_count: meta.new_count ?? 0,
      old_count: meta.old_count ?? 0,
    };
  }, [meta, items]);

  useEffect(() => {
    setPage(1);
  }, [q, categoryFilter, locationId, company, statusFilter, stockKind, pageSize]);

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

  function openAsset(r: StockItem) {
    const code = String(r.company_code ?? company).toUpperCase();
    const companyParam = code === 'ITL' ? 'IT' : code || 'IT';
    const params = new URLSearchParams();
    params.set('view', String(r.id));
    params.set('company', companyParam);
    params.set('returnTo', '/reports/stock');
    navigate(`${assetPath(String(r.category))}?${params.toString()}`);
  }

  const clearFilters = () => {
    setQ('');
    setCategoryFilter('all');
    setStockKind('all');
    setStatusFilter('available');
    setLocationId(headOfficeLocationId(company, companyLocations));
  };

  return (
    <main className="page">
      <div className="no-print">
        <PageHeader
          eyebrow="Reports"
          title="Stock Report"
          badge={<LiveRepositoryBadge />}
          subtitle="All available assets (new stock and old) by company and branch. Click a row to open the asset view."
        />

        <div className="tabs-secondary company-tabs-row" style={{ marginBottom: '0.85rem' }}>
          {COMPANY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab-btn${company === tab.id ? ' active' : ''}`}
              onClick={() => {
                setLocationReady(false);
                setCompany(tab.id);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <section className="card asset-filter-panel" style={{ marginBottom: '1rem' }}>
          <div
            className="asset-filter-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
          >
            <label className="asset-filter-field">
              <span className="asset-filter-label">Branch / location</span>
              <select
                className="asset-filter-control"
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  setCategoryFilter('all');
                }}
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
              <span className="asset-filter-label">Status</span>
              <select
                className="asset-filter-control"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="asset-filter-field">
              <span className="asset-filter-label">Stock</span>
              <select
                className="asset-filter-control"
                value={stockKind}
                onChange={(e) => setStockKind(e.target.value as StockKind)}
              >
                <option value="all">New + old</option>
                <option value="new">New stock only</option>
                <option value="old">Old assets only</option>
              </select>
            </label>
            <label className="asset-filter-field" style={{ gridColumn: 'span 2' }}>
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
              onClick={clearFilters}
              disabled={
                !q &&
                categoryFilter === 'all' &&
                stockKind === 'all' &&
                statusFilter === 'available' &&
                locationId === headOfficeLocationId(company, companyLocations)
              }
            >
              Reset filters
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
          <section className="branch-stat-row no-print" aria-label="Stock counts">
            {CATEGORY_CARDS.map((card) => {
              const value = counts[card.key as keyof typeof counts] ?? 0;
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
                  </div>
                  <strong className="branch-stat-value">{value}</strong>
                  <span className="branch-stat-hint">
                    {selectedLocationName} · {assetStatusLabel(statusFilter)}
                  </span>
                </button>
              );
            })}
            <div className="branch-stat-card tone-orange" style={{ cursor: 'default' }}>
              <div className="branch-stat-top">
                <span className="branch-stat-label">New / old</span>
              </div>
              <strong className="branch-stat-value" style={{ fontSize: '1.25rem' }}>
                {counts.new_count} / {counts.old_count}
              </strong>
              <span className="branch-stat-hint">In current filter</span>
            </div>
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
                  {selectedLocationName} stock
                  {categoryFilter !== 'all' ? (
                    <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: '0.95rem' }}>
                      {' '}
                      · {catLabel(categoryFilter)}
                    </span>
                  ) : null}
                </h3>
                <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
                  Status defaults to Available so every free item is listed. Click a row to open the
                  view tab.
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
                title="No stock for this filter"
                description="Try Available status, another branch, or clear New/Old stock filter."
              />
            ) : (
              <div className="table-wrap">
                <table className="table asset-data-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Asset ID</th>
                      <th>Name / holder</th>
                      <th>Brand / item</th>
                      <th>Location</th>
                      <th>Stock</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedItems.map((r) => {
                      const isOld = Boolean(r.is_legacy) || r.stock_kind === 'old';
                      return (
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
                          <td>{dash(r.holder_name)}</td>
                          <td>
                            {r.category === 'other'
                              ? dash(r.item_name || r.brand)
                              : dash([r.brand, r.model].filter(Boolean).join(' '))}
                          </td>
                          <td>{dash(r.location_name)}</td>
                          <td>
                            <span className={`stock-pill ${isOld ? 'old' : 'new'}`}>
                              {isOld ? 'Old' : 'New'}
                            </span>
                          </td>
                          <td>
                            <StatusBadge
                              status={String(r.status ?? '')}
                              label={assetStatusLabel(String(r.status ?? ''))}
                            />
                          </td>
                        </tr>
                      );
                    })}
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
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
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
          min-height: 6.25rem;
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
        .branch-stat-value {
          font-size: 1.65rem;
          line-height: 1.1;
          color: #111827;
        }
        .branch-stat-hint {
          font-size: 0.72rem;
          color: #9ca3af;
        }
        .stock-pill {
          display: inline-block;
          font-size: 0.72rem;
          font-weight: 700;
          border-radius: 999px;
          padding: 0.15rem 0.5rem;
        }
        .stock-pill.new {
          background: #dcfce7;
          color: #166534;
        }
        .stock-pill.old {
          background: #f1f5f9;
          color: #475569;
        }
      `}</style>
    </main>
  );
}
