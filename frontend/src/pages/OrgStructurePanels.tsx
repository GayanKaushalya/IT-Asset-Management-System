import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import StatusBadge from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import { DataTableShell } from '../components/ui/DataTable';
import PaginationBar from '../components/ui/PaginationBar';
import TableSettingsMenu, { type PageSize } from '../components/ui/TableSettingsMenu';
import { Modal } from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
import { api } from '../services/client';
import { clearOrgMetaCache } from '../services/metaCache';

type CompanyTab = 'ALL' | 'IT' | 'IMS' | 'ISP';
type Company = { id: number; code: string; short_name: string; name: string };
type Loc = { id: number; company_id: number; code: string; name: string; city?: string | null };
type Row = Record<string, unknown>;

type OrgLocation = {
  name: string;
  company_code: string;
  company_short?: string;
  employee_count: number;
  department_count: number;
};

type OrgEmployee = {
  id: number;
  staff_id: string;
  name: string;
  display_name?: string | null;
  designation?: string | null;
  department_name?: string | null;
  employment_status?: string;
};

const COMPANY_FILTERS: { id: CompanyTab; label: string }[] = [
  { id: 'ALL', label: 'All companies' },
  { id: 'IT', label: 'ITL' },
  { id: 'IMS', label: 'IMS' },
  { id: 'ISP', label: 'ISP' },
];

const LOC_PAGE_KEY = 'itams.org.locations.pageSize';
const DEPT_PAGE_KEY = 'itams.org.departments.pageSize';

function readStoredPageSize(key: string): PageSize {
  try {
    const raw = Number(localStorage.getItem(key));
    if (raw === 5 || raw === 10 || raw === 20 || raw === 50 || raw === 100 || raw === 500) return raw;
  } catch {
    /* ignore */
  }
  return 10;
}

function canManageOrg(role: string | undefined): boolean {
  return role === 'super_admin' || role === 'it_admin' || role === 'it_staff';
}

function dash(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v);
}

function companyLabel(code?: string, short?: string): string {
  if (short) return short;
  if (code === 'IT') return 'ITL';
  return code || '—';
}

/** HR work locations from the Excel staff directory. */
export function LocationsPanel() {
  const [company, setCompany] = useState<CompanyTab>('ALL');
  const [rows, setRows] = useState<OrgLocation[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(() => readStoredPageSize(LOC_PAGE_KEY));
  const [viewLoc, setViewLoc] = useState<OrgLocation | null>(null);
  const [staff, setStaff] = useState<OrgEmployee[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (company !== 'ALL') params.set('company', company);
      const res = await api<{ data: OrgLocation[] }>(`/api/employees/locations?${params.toString()}`);
      setRows(res.data ?? []);
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load locations');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(term) ||
        String(r.company_short || r.company_code || '')
          .toLowerCase()
          .includes(term),
    );
  }, [rows, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const from = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, filtered.length);
  const filtersActive = Boolean(q.trim() || company !== 'ALL');

  function changePageSize(size: PageSize) {
    setPageSize(size);
    setPage(1);
    try {
      localStorage.setItem(LOC_PAGE_KEY, String(size));
    } catch {
      /* ignore */
    }
  }

  async function openView(loc: OrgLocation) {
    setViewLoc(loc);
    setStaff([]);
    setStaffLoading(true);
    try {
      const params = new URLSearchParams({
        company: loc.company_code || 'IT',
        location: loc.name,
        limit: '1000',
      });
      const res = await api<{ data: OrgEmployee[] }>(`/api/employees?${params.toString()}`);
      setStaff(res.data ?? []);
    } catch {
      setStaff([]);
    } finally {
      setStaffLoading(false);
    }
  }

  return (
    <>
      <div className="asset-filter-panel">
        <div className="asset-filter-grid">
          <label className="asset-filter-field">
            <span className="asset-filter-label">Search</span>
            <input
              className="asset-filter-control"
              placeholder="Search location…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="asset-filter-field">
            <span className="asset-filter-label">Company</span>
            <select
              className="asset-filter-control"
              value={company}
              onChange={(e) => setCompany(e.target.value as CompanyTab)}
            >
              {COMPANY_FILTERS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="asset-filter-field">
            <span className="asset-filter-label">Filter</span>
            <select className="asset-filter-control" value="" disabled>
              <option value="">All locations</option>
            </select>
          </label>
        </div>
        <div className="asset-filter-footer">
          <p className="asset-filter-count">
            {loading ? (
              'Loading…'
            ) : (
              <>
                Showing <strong>{filtered.length === 0 ? '0' : `${from}–${to}`}</strong> of{' '}
                <strong>{filtered.length}</strong> location{filtered.length === 1 ? '' : 's'}
              </>
            )}
          </p>
          <div className="asset-filter-actions">
            <button
              type="button"
              className="asset-filter-clear"
              disabled={!filtersActive}
              onClick={() => {
                setQ('');
                setCompany('ALL');
                setPage(1);
              }}
            >
              Clear filters
            </button>
            <TableSettingsMenu
              pageSize={pageSize}
              onPageSizeChange={changePageSize}
              onRefresh={() => void load()}
              refreshing={loading}
              rangeLabel={filtered.length === 0 ? '0 of 0' : `${from} - ${to} of ${filtered.length}`}
            />
            <PaginationBar
              page={safePage}
              totalPages={totalPages}
              onPageChange={setPage}
              disabled={loading}
            />
          </div>
        </div>
      </div>

      <DataTableShell>
        {loading ? (
          <LoadingSkeleton rows={8} />
        ) : error ? (
          <ErrorState description={error} onRetry={() => void load()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No locations found" description="Try another company or clear the search." />
        ) : (
          <table className="table org-table">
            <thead>
              <tr>
                <th className="org-col-num">#</th>
                <th>Location</th>
                <th>Company</th>
                <th>Staff</th>
                <th>Departments</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => (
                <tr key={`${r.company_code}-${r.name}`}>
                  <td className="org-col-num muted">{(safePage - 1) * pageSize + i + 1}</td>
                  <td>
                    <strong className="org-emp-name">{r.name}</strong>
                  </td>
                  <td>{companyLabel(r.company_code, r.company_short)}</td>
                  <td>{r.employee_count ?? '—'}</td>
                  <td>{r.department_count ?? '—'}</td>
                  <td>
                    <button type="button" className="btn btn-soft" onClick={() => void openView(r)}>
                      View staff
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableShell>

      <Modal
        open={!!viewLoc}
        title={viewLoc?.name || 'Location'}
        eyebrow={viewLoc?.company_short || viewLoc?.company_code || 'Organization'}
        onClose={() => setViewLoc(null)}
        wide
        footer={
          <button type="button" className="btn btn-soft" onClick={() => setViewLoc(null)}>
            Close
          </button>
        }
      >
        {staffLoading ? (
          <LoadingSkeleton rows={5} />
        ) : staff.length === 0 ? (
          <EmptyState title="No staff at this location" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Staff ID</th>
                <th>Name</th>
                <th>Designation</th>
                <th>Department</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((e) => (
                <tr key={e.id}>
                  <td>{e.staff_id}</td>
                  <td>{e.display_name || e.name}</td>
                  <td>{e.designation || '—'}</td>
                  <td>{e.department_name || '—'}</td>
                  <td>{e.employment_status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </>
  );
}

export function DepartmentsPanel() {
  const { user } = useAuth();
  const toast = useToast();
  const manage = canManageOrg(user?.role);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<Loc[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [company, setCompany] = useState<CompanyTab>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(() => readStoredPageSize(DEPT_PAGE_KEY));
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ company_id: '', location_id: '', code: '', name: '' });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await api<{ data: Row[] }>('/api/departments');
      setRows(res.data ?? []);
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load departments');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void Promise.all([api<{ data: Company[] }>('/api/companies'), api<{ data: Loc[] }>('/api/locations')])
      .then(([cRes, lRes]) => {
        setCompanies(cRes.data ?? []);
        setLocations(lRes.data ?? []);
        const defaultCompany = String(user?.company_id || cRes.data?.[0]?.id || '');
        setForm((f) => ({ ...f, company_id: f.company_id || defaultCompany }));
      })
      .catch(() => {
        setCompanies([]);
        setLocations([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let list = rows;
    if (company !== 'ALL') {
      const code = company;
      list = list.filter((r) => {
        const c = String(r.company_code || '').toUpperCase();
        return c === code || (code === 'IT' && (c === 'IT' || c === 'ITL'));
      });
    }
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter((r) =>
      ['code', 'name', 'company_short', 'company_code', 'location_name'].some((k) =>
        String(r[k] ?? '')
          .toLowerCase()
          .includes(term),
      ),
    );
  }, [rows, q, company]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const from = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, filtered.length);
  const filtersActive = Boolean(q.trim() || company !== 'ALL');

  const locsForCompany = useMemo(
    () => locations.filter((l) => !form.company_id || Number(l.company_id) === Number(form.company_id)),
    [locations, form.company_id],
  );

  function changePageSize(size: PageSize) {
    setPageSize(size);
    setPage(1);
    try {
      localStorage.setItem(DEPT_PAGE_KEY, String(size));
    } catch {
      /* ignore */
    }
  }

  function suggestDeptCode(name: string): string {
    const code = name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    return code || 'DEPT';
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const name = form.name.trim();
      const code = form.code.trim() || suggestDeptCode(name);
      await api('/api/departments', {
        method: 'POST',
        body: JSON.stringify({
          company_id: form.company_id ? Number(form.company_id) : undefined,
          location_id: form.location_id ? Number(form.location_id) : undefined,
          code,
          name,
        }),
      });
      clearOrgMetaCache();
      setShow(false);
      setForm((f) => ({ ...f, code: '', name: '', location_id: '' }));
      toast.success('Department created');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create department');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="asset-filter-panel">
        <div className="asset-filter-grid">
          <label className="asset-filter-field">
            <span className="asset-filter-label">Search</span>
            <input
              className="asset-filter-control"
              placeholder="Search department…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="asset-filter-field">
            <span className="asset-filter-label">Company</span>
            <select
              className="asset-filter-control"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value as CompanyTab);
                setPage(1);
              }}
            >
              {COMPANY_FILTERS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="asset-filter-field">
            <span className="asset-filter-label">Filter</span>
            <select className="asset-filter-control" value="" disabled>
              <option value="">All departments</option>
            </select>
          </label>
        </div>
        <div className="asset-filter-footer">
          <p className="asset-filter-count">
            {loading ? (
              'Loading…'
            ) : (
              <>
                Showing <strong>{filtered.length === 0 ? '0' : `${from}–${to}`}</strong> of{' '}
                <strong>{filtered.length}</strong> department{filtered.length === 1 ? '' : 's'}
              </>
            )}
          </p>
          <div className="asset-filter-actions">
            <button
              type="button"
              className="asset-filter-clear"
              disabled={!filtersActive}
              onClick={() => {
                setQ('');
                setCompany('ALL');
                setPage(1);
              }}
            >
              Clear filters
            </button>
            {manage ? (
              <button type="button" className="btn btn-primary" onClick={() => setShow(true)}>
                + Add department
              </button>
            ) : null}
            <TableSettingsMenu
              pageSize={pageSize}
              onPageSizeChange={changePageSize}
              onRefresh={() => void load()}
              refreshing={loading}
              rangeLabel={filtered.length === 0 ? '0 of 0' : `${from} - ${to} of ${filtered.length}`}
            />
            <PaginationBar
              page={safePage}
              totalPages={totalPages}
              onPageChange={setPage}
              disabled={loading}
            />
          </div>
        </div>
      </div>

      <DataTableShell>
        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : error ? (
          <ErrorState description={error} onRetry={() => void load()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No departments found" description="Try another filter or add a department." />
        ) : (
          <table className="table org-table">
            <thead>
              <tr>
                <th className="org-col-num">#</th>
                <th>Code</th>
                <th>Name</th>
                <th>Company</th>
                <th>Location</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => (
                <tr key={String(r.id)}>
                  <td className="org-col-num muted">{(safePage - 1) * pageSize + i + 1}</td>
                  <td>{dash(r.code)}</td>
                  <td>
                    <strong className="org-emp-name">{dash(r.name)}</strong>
                  </td>
                  <td>{dash(r.company_short || r.company_code)}</td>
                  <td>{dash(r.location_name)}</td>
                  <td>
                    <StatusBadge status="active" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableShell>

      <Modal
        open={show}
        title="Add department"
        eyebrow="Organization"
        onClose={() => setShow(false)}
        footer={
          <>
            <button type="button" className="btn btn-soft" disabled={saving} onClick={() => setShow(false)}>
              Cancel
            </button>
            <button type="submit" form="add-dept-form" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Create'}
            </button>
          </>
        }
      >
        <form id="add-dept-form" className="form-grid" onSubmit={(e) => void onCreate(e)}>
          <p className="org-form-hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
            Pick company and type the department name — code is filled automatically.
          </p>
          <label>
            Company *
            <select
              className="select"
              required
              value={form.company_id}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, company_id: e.target.value, location_id: '' }))
              }
            >
              {companies
                .filter((c) => ['IT', 'ITL', 'IMS', 'ISP'].includes(String(c.code || '').toUpperCase()))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {String(c.code).toUpperCase() === 'IT' ? 'ITL' : c.short_name || c.code}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Department name *
            <input
              className="input"
              required
              placeholder="e.g. Support Services"
              value={form.name}
              onChange={(e) => {
                const name = e.target.value;
                setForm((prev) => ({
                  ...prev,
                  name,
                  // Keep auto code in sync until user edits code manually
                  code:
                    !prev.code || prev.code === suggestDeptCode(prev.name)
                      ? suggestDeptCode(name)
                      : prev.code,
                }));
              }}
            />
          </label>
          <label>
            Code <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(auto)</span>
            <input
              className="input"
              placeholder="Auto from name"
              value={form.code}
              onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
            />
          </label>
          <label>
            Location
            <select
              className="select"
              value={form.location_id}
              onChange={(e) => setForm((prev) => ({ ...prev, location_id: e.target.value }))}
            >
              <option value="">Optional</option>
              {locsForCompany.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </form>
      </Modal>
    </>
  );
}
