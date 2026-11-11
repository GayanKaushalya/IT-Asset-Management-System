import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import { useToast } from '../components/ui/Toast';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import { api, downloadAuthenticated, getToken } from '../services/client';
import { getOrgMeta, type MetaCompany, type MetaDepartment, type MetaLocation } from '../services/metaCache';
import {
  ITEM_TYPES,
  PAYMENT_STATUSES,
  companyLabel,
  formatLkr,
  itemTypeLabel,
} from './expenditureTypes';
import { DATE_INPUT_MIN as DATE_MIN } from '../lib/dateInput';

type ReportRow = {
  id: number;
  reference_no?: string;
  expense_date?: string;
  company_code?: string;
  company_short?: string;
  company_label?: string;
  location_name?: string | null;
  department_name?: string | null;
  item_name?: string;
  item_type?: string;
  brand?: string | null;
  model?: string | null;
  quantity?: number;
  unit_price_lkr?: number;
  line_total_lkr?: number;
  supplier_name?: string | null;
  invoice_no?: string | null;
  payment_status?: string;
};

type CompanyBlock = {
  company_code: string;
  company_label: string;
  total_lkr: number;
  total_quantity: number;
  transaction_count: number;
  outstanding_lkr: number;
  by_item_type: { item_type: string; quantity: number; total_lkr: number }[];
  by_item: {
    item_name: string;
    item_type: string;
    brand?: string | null;
    model?: string | null;
    quantity: number;
    total_lkr: number;
    avg_unit_price: number;
  }[];
  transactions: { id: number; reference_no?: string; expense_date?: string; total_lkr: number }[];
};

type ReportData = {
  from_date: string;
  to_date: string;
  summary: {
    total_expenditure_lkr: number;
    total_quantity: number;
    distinct_item_types: number;
    transaction_count: number;
    outstanding_lkr: number;
    by_company: { company_code: string; company_label: string; total_lkr: number }[];
  };
  by_company: CompanyBlock[];
  rows: ReportRow[];
};

const API_URL = String(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

function monthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ExpenditureReportPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [companies, setCompanies] = useState<MetaCompany[]>([]);
  const [locations, setLocations] = useState<MetaLocation[]>([]);
  const [departments, setDepartments] = useState<MetaDepartment[]>([]);

  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(today);
  const [company, setCompany] = useState('ALL');
  const [locationId, setLocationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [itemType, setItemType] = useState('');
  const [itemName, setItemName] = useState('');
  const [brand, setBrand] = useState('');
  const [supplier, setSupplier] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [approvedOnly, setApprovedOnly] = useState(false);

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void getOrgMeta().then((m) => {
      setCompanies(m.companies);
      setLocations(m.locations);
      setDepartments(m.departments);
    });
  }, []);

  const filteredLocs = useMemo(() => {
    if (company === 'ALL') return locations;
    const co = companies.find((c) => c.code === (company === 'ITL' ? 'IT' : company));
    if (!co) return locations;
    return locations.filter((l) => Number(l.company_id) === Number(co.id));
  }, [locations, companies, company]);

  function buildParams(): URLSearchParams {
    const p = new URLSearchParams();
    p.set('from_date', fromDate);
    p.set('to_date', toDate);
    if (company && company !== 'ALL') p.set('company', company === 'ITL' ? 'IT' : company);
    if (locationId) p.set('location_id', locationId);
    if (departmentId) p.set('department_id', departmentId);
    if (itemType) p.set('item_type', itemType);
    if (itemName.trim()) p.set('item_name', itemName.trim());
    if (brand.trim()) p.set('brand', brand.trim());
    if (supplier.trim()) p.set('supplier', supplier.trim());
    if (paymentStatus) p.set('payment_status', paymentStatus);
    if (approvedOnly) p.set('approved_only', '1');
    return p;
  }

  async function applyFilters() {
    if (!fromDate || !toDate) {
      toast.error('From Date and To Date are required');
      return;
    }
    if (fromDate > toDate) {
      toast.error('From Date cannot be later than To Date');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api<{ data: ReportData }>(`/api/expenditures/report?${buildParams()}`);
      setData(res.data);
      const open: Record<string, boolean> = {};
      for (const c of res.data.by_company ?? []) open[c.company_code] = true;
      setExpanded(open);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function resetFilters() {
    setFromDate(monthStart());
    setToDate(today());
    setCompany('ALL');
    setLocationId('');
    setDepartmentId('');
    setItemType('');
    setItemName('');
    setBrand('');
    setSupplier('');
    setPaymentStatus('');
    setApprovedOnly(false);
    setData(null);
    setError('');
  }

  async function exportCsv() {
    if (!fromDate || !toDate || fromDate > toDate) {
      toast.error('Set a valid date range first');
      return;
    }
    const p = buildParams();
    p.set('format', 'csv');
    try {
      await downloadAuthenticated(`/api/expenditures/report?${p}`, `it-expenditure-${fromDate}_to_${toDate}.csv`);
      toast.success('CSV downloaded');
    } catch (err) {
      // Fallback fetch if download helper fails on CSV content-type
      try {
        const token = getToken();
        const res = await fetch(`${API_URL}/api/expenditures/report?${p}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `it-expenditure-${fromDate}_to_${toDate}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('CSV downloaded');
      } catch (e2) {
        toast.error(err instanceof Error ? err.message : 'Export failed');
        void e2;
      }
    }
  }

  function printPdf() {
    window.print();
  }

  useEffect(() => {
    void applyFilters();
    // initial load for current month
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = data?.summary;

  return (
    <main className="page page--fill">
      <PageHeader
        eyebrow="Finance & Procurement"
        title="IT Expenditure Report"
        subtitle="Mandatory date-range spend report with company-wise item quantities and values from live ledger records."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Link className="btn btn-soft" to="/expenditures">
              ← Expenditure register
            </Link>
            <button type="button" className="btn btn-soft" onClick={() => void exportCsv()}>
              Export CSV
            </button>
            <button type="button" className="btn btn-soft" onClick={printPdf}>
              Print / PDF
            </button>
          </div>
        }
      />

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '0.65rem' }}>
          <label>
            From date *
            <input
              className="input"
              type="date"
              min={DATE_MIN}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label>
            To date *
            <input
              className="input"
              type="date"
              min={DATE_MIN}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
          {user?.role === 'super_admin' ? (
            <label>
              Company
              <select className="select" value={company} onChange={(e) => setCompany(e.target.value)}>
                <option value="ALL">All</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.code === 'IT' ? 'ITL' : c.short_name || c.code}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Branch
            <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">All</option>
              {filteredLocs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Department
            <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">All</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Item category
            <select className="select" value={itemType} onChange={(e) => setItemType(e.target.value)}>
              <option value="">All</option>
              {ITEM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Item name
            <input className="input" value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </label>
          <label>
            Brand / model
            <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </label>
          <label>
            Supplier
            <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </label>
          <label>
            Payment status
            <select className="select" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
              <option value="">All</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22 }}>
            <input type="checkbox" checked={approvedOnly} onChange={(e) => setApprovedOnly(e.target.checked)} />
            Approved expenditure only
          </label>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem' }}>
          <button type="button" className="btn btn-primary" onClick={() => void applyFilters()}>
            Apply filters
          </button>
          <button type="button" className="btn btn-soft" onClick={resetFilters}>
            Reset filters
          </button>
        </div>
        <p style={{ margin: '0.6rem 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
          Report covers {approvedOnly ? 'approved' : 'all non-voided'} expenditure by purchase/expense date
          (inclusive). Voided transactions are excluded unless enabled in API.
        </p>
      </div>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <ErrorState title="Report error" description={error} /> : null}

      {summary ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <SummaryCard label="Total expenditure" value={formatLkr(summary.total_expenditure_lkr)} />
            <SummaryCard label="Total qty (physical)" value={String(summary.total_quantity)} />
            <SummaryCard label="Distinct item types" value={String(summary.distinct_item_types)} />
            <SummaryCard label="Transactions" value={String(summary.transaction_count)} />
            <SummaryCard label="Outstanding payments" value={formatLkr(summary.outstanding_lkr)} />
          </div>

          <div className="card" style={{ marginBottom: '1rem' }}>
            <h3 style={{ marginTop: 0 }}>Company comparison</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Total spend</th>
                    <th>Physical qty</th>
                    <th>Transactions</th>
                    <th>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.by_company ?? []).map((c) => (
                    <tr key={c.company_code}>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [c.company_code]: !prev[c.company_code] }))
                          }
                        >
                          {expanded[c.company_code] ? '▼' : '▶'} {c.company_label}
                        </button>
                      </td>
                      <td>{formatLkr(c.total_lkr)}</td>
                      <td>{c.total_quantity}</td>
                      <td>{c.transaction_count}</td>
                      <td>{formatLkr(c.outstanding_lkr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(data?.by_company ?? []).map((c) =>
              expanded[c.company_code] ? (
                <div key={`detail-${c.company_code}`} style={{ marginTop: '1rem' }}>
                  <h4>
                    {c.company_label} — by category
                  </h4>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Item category</th>
                          <th>Qty</th>
                          <th>Total value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.by_item_type.map((t) => (
                          <tr key={t.item_type}>
                            <td>{itemTypeLabel(t.item_type)}</td>
                            <td>{t.quantity}</td>
                            <td>{formatLkr(t.total_lkr)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <h4>By item / model</h4>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Category</th>
                          <th>Brand</th>
                          <th>Model</th>
                          <th>Qty</th>
                          <th>Avg unit</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.by_item.map((it, i) => (
                          <tr key={`${it.item_name}-${i}`}>
                            <td>{it.item_name}</td>
                            <td>{itemTypeLabel(it.item_type)}</td>
                            <td>{it.brand || '—'}</td>
                            <td>{it.model || '—'}</td>
                            <td>{it.quantity}</td>
                            <td>{formatLkr(it.avg_unit_price)}</td>
                            <td>{formatLkr(it.total_lkr)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null,
            )}
          </div>

          <div className="card table-card">
            <h3 style={{ margin: '0.75rem' }}>Detailed expenditure lines</h3>
            {(data?.rows?.length ?? 0) === 0 ? (
              <EmptyState title="No matching lines" description="Adjust filters or date range." />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Company</th>
                      <th>Branch</th>
                      <th>Dept</th>
                      <th>Item</th>
                      <th>Category</th>
                      <th>Brand / Model</th>
                      <th>Qty</th>
                      <th>Unit</th>
                      <th>Line total</th>
                      <th>Supplier</th>
                      <th>Invoice</th>
                      <th>Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.rows ?? []).map((r, idx) => (
                      <tr key={`${r.id}-${r.item_name}-${idx}`}>
                        <td>{String(r.expense_date ?? '').slice(0, 10)}</td>
                        <td>{r.company_label || companyLabel(r.company_code, r.company_short)}</td>
                        <td>{r.location_name || '—'}</td>
                        <td>{r.department_name || '—'}</td>
                        <td>{r.item_name}</td>
                        <td>{itemTypeLabel(String(r.item_type ?? ''))}</td>
                        <td>{[r.brand, r.model].filter(Boolean).join(' ') || '—'}</td>
                        <td>{r.quantity}</td>
                        <td>{formatLkr(r.unit_price_lkr)}</td>
                        <td>{formatLkr(r.line_total_lkr)}</td>
                        <td>{r.supplier_name || '—'}</td>
                        <td>{r.invoice_no || '—'}</td>
                        <td>{r.payment_status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: '0.9rem 1rem' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  );
}
