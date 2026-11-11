import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import PaginationBar from '../components/ui/PaginationBar';
import TableSettingsMenu, { PAGE_SIZE_OPTIONS, type PageSize } from '../components/ui/TableSettingsMenu';
import { api } from '../services/client';
import { getOrgMeta, type MetaCompany, type MetaDepartment, type MetaLocation } from '../services/metaCache';
import { formatLkr } from './expenditureTypes';
import { DATE_INPUT_MIN as DATE_MIN } from '../lib/dateInput';

const PAGE_SIZE_KEY = 'itams.expenditure.pageSize';

function readStoredPageSize(): PageSize {
  try {
    const raw = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(raw)) return raw as PageSize;
  } catch {
    /* ignore */
  }
  return 5;
}

type SpendRow = {
  asset_category: string;
  asset_id: number;
  asset_tag: string;
  item_name: string;
  item_type: string;
  brand?: string | null;
  model?: string | null;
  purchase_amount_lkr: number;
  purchase_date: string | null;
  acquired_date: string | null;
  invoice_no?: string | null;
  company_code?: string | null;
  company_label?: string | null;
  location_name?: string | null;
  department_name?: string | null;
  staff_name?: string | null;
};

type SpendSummary = {
  total_spend: number;
  asset_count: number;
  with_price_count: number;
  by_company: {
    company_code: string;
    company_label: string;
    asset_count: number;
    total_spend: number;
  }[];
  by_category: {
    asset_category: string;
    item_type: string;
    asset_count: number;
    total_spend: number;
  }[];
};

type AssetCategoryFilter = '' | 'laptop' | 'mobile_phone' | 'pc' | 'other';

const COMPANY_TABS: { id: string; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'IT', label: 'ITL' },
  { id: 'IMS', label: 'IMS' },
  { id: 'ISP', label: 'ISP' },
];

function normalizeCompanyCode(code?: string | null): string {
  const c = (code || '').toUpperCase();
  if (c === 'ITL') return 'IT';
  return c;
}

function sameCompany(a?: string | null, b?: string | null): boolean {
  return normalizeCompanyCode(a) === normalizeCompanyCode(b);
}

function monthStartIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function allFromIso(): string {
  return DATE_MIN;
}

function yearStartIso(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function companyDisplay(code?: string | null, label?: string | null): string {
  if ((code || '').toUpperCase() === 'IT') return 'ITL';
  return label || code || '—';
}

function companyTone(code?: string | null): 'itl' | 'ims' | 'isp' | 'neutral' {
  const c = (code || '').toUpperCase();
  if (c === 'IT' || c === 'ITL') return 'itl';
  if (c === 'IMS') return 'ims';
  if (c === 'ISP') return 'isp';
  return 'neutral';
}

function itemTitle(r: SpendRow): string {
  const bm = [r.brand, r.model].filter(Boolean).join(' ').trim();
  if (bm) return bm;
  return r.item_name || r.asset_tag || 'Item';
}

function itemSubtitle(r: SpendRow): string {
  const title = itemTitle(r);
  if (r.asset_tag && r.asset_tag !== title) return r.asset_tag;
  if (r.model && title !== r.model) return String(r.model);
  return r.item_name && r.item_name !== title ? r.item_name : '';
}

function IconLaptop({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </svg>
  );
}

function IconPhone({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

function IconPc({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="13" rx="1.5" />
      <path d="M8 21h8M12 16v5" />
    </svg>
  );
}

function IconOther({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.3 7L12 12l8.7-5M12 12v10" />
    </svg>
  );
}

function categoryIcon(category: string, size = 16) {
  if (category === 'mobile_phone') return <IconPhone size={size} />;
  if (category === 'pc') return <IconPc size={size} />;
  if (category === 'other') return <IconOther size={size} />;
  return <IconLaptop size={size} />;
}

function categoryIconClass(category: string): string {
  if (category === 'mobile_phone') return 'is-phone';
  if (category === 'pc') return 'is-pc';
  if (category === 'other') return 'is-other';
  return 'is-laptop';
}

function IconCoin() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v10M9.5 9.5c.6-1 1.7-1.5 2.8-1.5 1.7 0 2.7 1 2.7 2.2 0 2.5-5 1.6-5 4.1 0 1.1 1 2.2 2.8 2.2 1.2 0 2.1-.5 2.7-1.4" />
    </svg>
  );
}

function IconBox() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
      <path d="M3 8l9 5 9-5M12 13v10" />
    </svg>
  );
}

function IconTag() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 12l-8 8-9-9V3h8l9 9z" />
      <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function IconCalc() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M16 15h0M8 19h2M12 19h2M16 19h0" />
    </svg>
  );
}

function assetPathForCategory(category: string): string {
  if (category === 'mobile_phone') return '/assets/mobile-phones';
  if (category === 'laptop') return '/assets/laptop';
  if (category === 'pc') return '/assets/pc';
  if (category === 'other') return '/assets/others';
  return '/assets/laptop';
}

export default function ExpenditurePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<MetaCompany[]>([]);
  const [locations, setLocations] = useState<MetaLocation[]>([]);
  const [departments, setDepartments] = useState<MetaDepartment[]>([]);

  const [fromDate, setFromDate] = useState(monthStartIso);
  const [toDate, setToDate] = useState(todayIso);
  const [company, setCompany] = useState('ALL');
  const [locationId, setLocationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [category, setCategory] = useState<AssetCategoryFilter>('');
  const [q, setQ] = useState('');

  const [rows, setRows] = useState<SpendRow[]>([]);
  const [summary, setSummary] = useState<SpendSummary | null>(null);
  /** Always all sub-companies for the tab cards (not narrowed by selected company). */
  const [companyCards, setCompanyCards] = useState<SpendSummary['by_company']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(() => readStoredPageSize());

  useEffect(() => {
    void getOrgMeta().then((m) => {
      setCompanies(m.companies.filter((c) => ['IT', 'IMS', 'ISP'].includes(c.code)));
      setLocations(m.locations);
      setDepartments(m.departments);
    });
  }, []);

  const filterLocs = useMemo(() => {
    if (company === 'ALL') return locations;
    const code = normalizeCompanyCode(company);
    const co = companies.find((c) => c.code === code);
    if (!co) return locations;
    return locations.filter((l) => Number(l.company_id) === Number(co.id));
  }, [locations, companies, company]);

  const filterDeps = useMemo(() => {
    if (company === 'ALL') return departments;
    const code = normalizeCompanyCode(company);
    const co = companies.find((c) => c.code === code);
    if (!co) return departments;
    return departments.filter((d) => Number(d.company_id) === Number(co.id));
  }, [departments, companies, company]);

  function selectCompany(next: string) {
    const code = normalizeCompanyCode(next) || 'ALL';
    setCompany(code === '' ? 'ALL' : code);
    setLocationId('');
    setDepartmentId('');
  }

  const load = useCallback(async () => {
    if (!fromDate || !toDate) {
      setError('Choose a From date and a To date');
      setLoading(false);
      return;
    }
    if (fromDate > toDate) {
      setError('From date cannot be later than To date');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const base = new URLSearchParams();
      base.set('from_date', fromDate);
      base.set('to_date', toDate);
      if (locationId) base.set('location_id', locationId);
      if (departmentId) base.set('department_id', departmentId);
      if (category) base.set('category', category);
      if (q.trim()) base.set('q', q.trim());

      const filtered = new URLSearchParams(base);
      const companyCode = normalizeCompanyCode(company);
      if (companyCode && companyCode !== 'ALL') filtered.set('company', companyCode);

      const filteredReq = api<{ data: SpendRow[]; summary: SpendSummary }>(
        `/api/expenditures/inventory-spend?${filtered.toString()}`,
      );
      // Keep every sub-company card visible while a company tab is selected
      const cardsReq =
        companyCode && companyCode !== 'ALL'
          ? api<{ data: SpendRow[]; summary: SpendSummary }>(
              `/api/expenditures/inventory-spend?${base.toString()}`,
            )
          : null;

      const [res, cardsRes] = await Promise.all([filteredReq, cardsReq]);
      setRows(res.data ?? []);
      setSummary(res.summary ?? null);
      setCompanyCards((cardsRes ?? res).summary?.by_company ?? []);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to calculate expenditure');
      setRows([]);
      setSummary(null);
      setCompanyCards([]);
      setPage(1);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, company, locationId, departmentId, category, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageRows = useMemo(() => {
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

  function presetRange(kind: 'month' | 'year' | 'all') {
    if (kind === 'month') {
      setFromDate(monthStartIso());
      setToDate(todayIso());
    } else if (kind === 'year') {
      setFromDate(yearStartIso());
      setToDate(todayIso());
    } else {
      setFromDate(allFromIso());
      setToDate(todayIso());
    }
  }

  const phoneCat = summary?.by_category.find((c) => c.asset_category === 'mobile_phone');
  const laptopCat = summary?.by_category.find((c) => c.asset_category === 'laptop');
  const pcCat = summary?.by_category.find((c) => c.asset_category === 'pc');
  const otherCat = summary?.by_category.find((c) => c.asset_category === 'other');

  function openAssetView(r: SpendRow) {
    const path = assetPathForCategory(r.asset_category);
    const params = new URLSearchParams();
    params.set('view', String(r.asset_id));
    if (r.company_code) params.set('company', r.company_code);
    params.set('returnTo', '/expenditures');
    navigate(`${path}?${params.toString()}`);
  }

  return (
    <main className="page exp2-page">
      <PageHeader
        eyebrow="Finance & Procurement"
        title="IT Expenditure"
        subtitle="Spend from all asset tabs (laptops, phones, PCs, other). Date = Acquired On; amount from Assets. Total spend updates with your filters."
      />

      {user?.role === 'super_admin' ? (
        <div className="tabs-secondary company-tabs-row" style={{ marginBottom: '0.85rem' }}>
          {COMPANY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab-btn${
                (tab.id === 'ALL' ? company === 'ALL' : sameCompany(company, tab.id)) ? ' active' : ''
              }`}
              onClick={() => selectCompany(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      <section className="card exp2-filters">
        <div className="exp2-filters-row">
          <label className="exp2-field">
            <span>From date</span>
            <input
              className="input"
              type="date"
              min={DATE_MIN}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className="exp2-field">
            <span>To date</span>
            <input
              className="input"
              type="date"
              min={DATE_MIN}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
          <label className="exp2-field">
            <span>Branch / location</span>
            <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">All locations</option>
              {filterLocs.map((l) => (
                <option key={l.id} value={String(l.id)}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="exp2-field">
            <span>Department</span>
            <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">All departments</option>
              {filterDeps.map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="exp2-field">
            <span>Asset type</span>
            <select
              className="select"
              value={category}
              onChange={(e) => setCategory(e.target.value as AssetCategoryFilter)}
            >
              <option value="">All types</option>
              <option value="laptop">Laptop</option>
              <option value="mobile_phone">Mobile phone</option>
              <option value="pc">Desktop PC</option>
              <option value="other">Other assets</option>
            </select>
          </label>
          <label className="exp2-field exp2-field--search">
            <span>Search</span>
            <div className="exp2-search">
              <IconSearch />
              <input
                className="input"
                value={q}
                placeholder="e.g. name, serial, staff…"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void load();
                }}
              />
            </div>
          </label>
          <div className="exp2-field exp2-field--action">
            <span>&nbsp;</span>
            <button type="button" className="btn btn-primary exp2-calc" onClick={() => void load()}>
              <IconCalc /> Calculate
            </button>
          </div>
        </div>
      </section>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <ErrorState title="Could not calculate" description={error} /> : null}

      {!loading && summary ? (
        <>
          <section className="exp2-kpi-row">
            <article className="card exp2-kpi">
              <div className="exp2-kpi-icon">
                <IconCoin />
              </div>
              <div>
                <div className="exp2-kpi-label">
                  Total spend ({fromDate} → {toDate})
                </div>
                <div className="exp2-kpi-value">{formatLkr(summary.total_spend)}</div>
              </div>
            </article>
            <article className="card exp2-kpi">
              <div className="exp2-kpi-icon">
                <IconBox />
              </div>
              <div>
                <div className="exp2-kpi-label">Assets in period</div>
                <div className="exp2-kpi-value">{summary.asset_count}</div>
              </div>
            </article>
            <article className="card exp2-kpi">
              <div className="exp2-kpi-icon">
                <IconTag />
              </div>
              <div>
                <div className="exp2-kpi-label">With purchase price</div>
                <div className="exp2-kpi-value">{summary.with_price_count}</div>
              </div>
            </article>
          </section>

          <section className="exp2-company-block">
            <div className="exp2-company-title">Count &amp; spend by sub-company</div>
            <div className="exp2-company-row">
              <div className="exp2-company-cards">
                {(companyCards.length > 0 ? companyCards : summary.by_company).map((co) => {
                  const tone = companyTone(co.company_code);
                  const active = sameCompany(company, co.company_code);
                  return (
                    <button
                      key={co.company_code || co.company_label}
                      type="button"
                      className={`card exp2-co-card${active ? ' is-active' : ''}`}
                      title={active ? 'Show all companies' : `Filter to ${companyDisplay(co.company_code, co.company_label)}`}
                      onClick={() => {
                        if (active) selectCompany('ALL');
                        else selectCompany(co.company_code);
                      }}
                    >
                      <span className={`exp2-co-badge exp2-co-badge--${tone}`}>
                        {companyDisplay(co.company_code, co.company_label).slice(0, 3)}
                      </span>
                      <div className="exp2-co-text">
                        <strong>{companyDisplay(co.company_code, co.company_label)}</strong>
                        <span>
                          {co.asset_count} asset{co.asset_count === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="exp2-co-amt">{formatLkr(co.total_spend)}</div>
                    </button>
                  );
                })}
              </div>
              <div className="exp2-cat-pills">
                {laptopCat ? (
                  <button
                    type="button"
                    className={`exp2-cat-pill${category === 'laptop' ? ' is-active' : ''}`}
                    onClick={() => setCategory(category === 'laptop' ? '' : 'laptop')}
                  >
                    <IconLaptop size={14} />
                    Laptops: {laptopCat.asset_count} · {formatLkr(laptopCat.total_spend)}
                  </button>
                ) : null}
                {phoneCat ? (
                  <button
                    type="button"
                    className={`exp2-cat-pill${category === 'mobile_phone' ? ' is-active' : ''}`}
                    onClick={() => setCategory(category === 'mobile_phone' ? '' : 'mobile_phone')}
                  >
                    <IconPhone size={14} />
                    Mobile phones: {phoneCat.asset_count} · {formatLkr(phoneCat.total_spend)}
                  </button>
                ) : null}
                {pcCat ? (
                  <button
                    type="button"
                    className={`exp2-cat-pill${category === 'pc' ? ' is-active' : ''}`}
                    onClick={() => setCategory(category === 'pc' ? '' : 'pc')}
                  >
                    <IconPc size={14} />
                    Desktop PCs: {pcCat.asset_count} · {formatLkr(pcCat.total_spend)}
                  </button>
                ) : null}
                {otherCat ? (
                  <button
                    type="button"
                    className={`exp2-cat-pill${category === 'other' ? ' is-active' : ''}`}
                    onClick={() => setCategory(category === 'other' ? '' : 'other')}
                  >
                    <IconOther size={14} />
                    Other assets: {otherCat.asset_count} · {formatLkr(otherCat.total_spend)}
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        </>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <EmptyState
          title="No new purchases in this date range"
          description="Laptops, phones, newly purchased PCs, and other assets with Acquired On + purchase amount appear here. Try widening the dates or All types."
          action={
            <button type="button" className="btn btn-primary" onClick={() => presetRange('all')}>
              Show all purchases
            </button>
          }
        />
      ) : null}

      {!loading && rows.length > 0 ? (
        <section className="card exp2-table-card">
          <div className="exp2-table-head">
            <div className="exp2-table-title">Purchases</div>
            <div className="exp2-table-toolbar">
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
                disabled={loading}
              />
            </div>
          </div>
          <div className="table-wrap">
            <table className="table asset-data-table exp2-table">
              <thead>
                <tr>
                  <th>Purchased date</th>
                  <th>Item</th>
                  <th>User</th>
                  <th>Company</th>
                  <th>Location</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const purchased = (r.purchase_date || r.acquired_date || '—').toString().slice(0, 10);
                  const tone = companyTone(r.company_code);
                  const sub = itemSubtitle(r);
                  return (
                    <tr
                      key={`${r.asset_category}-${r.asset_id}`}
                      className="exp2-row-click"
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
                      <td className="exp2-date">{purchased}</td>
                      <td>
                        <div className="exp2-item">
                          <span className={`exp2-item-icon ${categoryIconClass(r.asset_category)}`}>
                            {categoryIcon(r.asset_category, 16)}
                          </span>
                          <div className="exp2-item-text">
                            <strong>{itemTitle(r)}</strong>
                            {sub ? <span>{sub}</span> : null}
                          </div>
                        </div>
                      </td>
                      <td>{r.staff_name || '—'}</td>
                      <td>
                        <span className={`exp2-pill exp2-pill--${tone}`}>
                          {companyDisplay(r.company_code, r.company_label)}
                        </span>
                      </td>
                      <td>{r.location_name || r.department_name || '—'}</td>
                      <td className="exp2-price">{formatLkr(r.purchase_amount_lkr)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="exp2-table-foot">
            {rows.length} purchase{rows.length === 1 ? '' : 's'} · {fromDate} → {toDate}
            {summary ? ` · Total ${formatLkr(summary.total_spend)}` : ''}
          </div>
        </section>
      ) : null}
    </main>
  );
}
