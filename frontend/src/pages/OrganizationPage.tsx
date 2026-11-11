import { FormEvent, useEffect, useMemo, useState, type ReactNode, type SVGProps } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import ActionsMenu from '../components/ActionsMenu';
import PageHeader from '../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import { DataTableShell } from '../components/ui/DataTable';
import PaginationBar from '../components/ui/PaginationBar';
import TableSettingsMenu, { type PageSize } from '../components/ui/TableSettingsMenu';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../auth/AuthContext';
import { api } from '../services/client';
import { DepartmentsPanel, LocationsPanel } from './OrgStructurePanels';

type OrgSection = 'employees' | 'locations' | 'departments';
type CompanyTab = 'ALL' | 'IT' | 'IMS' | 'ISP';
type SortKey = 'staff_id' | 'name' | 'epf_number' | 'designation' | 'work_location' | 'department_name';

const PAGE_SIZE_KEY = 'itams.org.employees.pageSize';

function readStoredPageSize(): PageSize {
  try {
    const raw = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (raw === 5 || raw === 10 || raw === 20 || raw === 50 || raw === 100 || raw === 500) return raw;
  } catch {
    /* ignore */
  }
  return 10;
}

const SECTIONS: { id: OrgSection; label: string; hint: string; icon: ReactNode }[] = [
  {
    id: 'employees',
    label: 'Employees',
    hint: 'Indra Group staff directory from HR (ITL · IMS · ISP)',
    icon: <IconUsers />,
  },
  {
    id: 'locations',
    label: 'Locations',
    hint: 'Work locations from the HR Excel directory (ITL · IMS · ISP)',
    icon: <IconPin />,
  },
  {
    id: 'departments',
    label: 'Departments',
    hint: 'Organizational departments linked to companies',
    icon: <IconOrg />,
  },
];

const SECTION_IDS = new Set(SECTIONS.map((s) => s.id));

type Employee = {
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
};

const COMPANY_FILTERS: { id: CompanyTab; label: string }[] = [
  { id: 'ALL', label: 'All companies' },
  { id: 'IT', label: 'ITL' },
  { id: 'IMS', label: 'IMS' },
  { id: 'ISP', label: 'ISP' },
];

function emptyForm() {
  return {
    company: 'IT' as 'IT' | 'IMS' | 'ISP',
    staff_id: '',
    name: '',
    title: '',
    epf_number: '',
    employment_status: 'Current',
    designation: '',
    work_location: '',
    department_name: '',
  };
}

function dash(v: unknown): string {
  if (v == null || String(v).trim() === '') return '—';
  return String(v);
}

function statusLabel(raw?: string | null): string {
  const s = String(raw || 'Current').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (s === 'former' || s === 'exemployee') return 'FORMER';
  if (s === 'probation') return 'PROBATION';
  if (s === 'current' || s === '') return 'CURRENT';
  return String(raw || 'Current').trim().toUpperCase();
}

function statusTone(raw?: string | null): 'current' | 'probation' | 'former' | 'other' {
  const s = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (s.includes('probation')) return 'probation';
  if (s.includes('former') || s.includes('exemployee')) return 'former';
  if (s === '' || s.includes('current')) return 'current';
  return 'other';
}

export default function OrganizationPage() {
  const { section: raw } = useParams();
  const section = (raw ?? 'employees') as OrgSection;
  const [tabCounts, setTabCounts] = useState<{
    employees: number | null;
    locations: number | null;
    departments: number | null;
  }>({ employees: null, locations: null, departments: null });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api<{ data?: unknown[] }>('/api/employees?limit=2000')
        .then((r) => (Array.isArray(r.data) ? r.data.length : 0))
        .catch(() => null),
      api<{ data?: unknown[] }>('/api/employees/locations')
        .then((r) => (Array.isArray(r.data) ? r.data.length : 0))
        .catch(() => null),
      api<{ data?: unknown[] }>('/api/departments')
        .then((r) => (Array.isArray(r.data) ? r.data.length : 0))
        .catch(() => null),
    ]).then(([employees, locations, departments]) => {
      if (cancelled) return;
      setTabCounts({ employees, locations, departments });
    });
    return () => {
      cancelled = true;
    };
  }, [section]);

  // Agreements moved to Asset Management sidebar
  if (raw === 'agreements') {
    return <Navigate to="/agreements" replace />;
  }
  if (!SECTION_IDS.has(section)) {
    return <Navigate to="/organization/employees" replace />;
  }

  const active = SECTIONS.find((s) => s.id === section)!;

  return (
    <main className="page page--fill org-directory">
      <PageHeader title={active.label} subtitle={active.hint} />

      <div className="org-section-tabs" role="tablist" aria-label="Organization sections">
        {SECTIONS.map((s) => {
          const count = tabCounts[s.id];
          return (
            <NavLink
              key={s.id}
              to={`/organization/${s.id}`}
              className={({ isActive }) => `org-section-tab${isActive ? ' active' : ''}`}
            >
              <span className="org-section-tab-icon" aria-hidden>
                {s.icon}
              </span>
              {s.label}
              {count != null ? (
                <span className="org-section-tab-count" aria-label={`${count} rows`}>
                  {count}
                </span>
              ) : null}
            </NavLink>
          );
        })}
      </div>

      {section === 'employees' ? <EmployeesPanel /> : null}
      {section === 'locations' ? <LocationsPanel /> : null}
      {section === 'departments' ? <DepartmentsPanel /> : null}

      <style>{ORG_DIRECTORY_CSS}</style>
    </main>
  );
}

function EmployeesPanel() {
  const toast = useToast();
  const { user } = useAuth();
  const canManage = ['super_admin', 'it_admin', 'it_staff'].includes(user?.role ?? '');

  const [company, setCompany] = useState<CompanyTab>('ALL');
  const [rows, setRows] = useState<Employee[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(() => readStoredPageSize());
  const [sortKey, setSortKey] = useState<SortKey>('staff_id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [viewEmp, setViewEmp] = useState<Employee | null>(null);
  const [editEmp, setEditEmp] = useState<Employee | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState(false);

  const formOpen = adding || !!editEmp;

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '1000' });
      if (company !== 'ALL') params.set('company', company);
      if (status) params.set('status', status);
      const res = await api<{ data: Employee[] }>(`/api/employees?${params.toString()}`);
      setRows(res.data ?? []);
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load employees');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, status]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = rows;
    if (term) {
      list = list.filter((r) =>
        [
          r.name,
          r.display_name,
          r.staff_id,
          r.epf_number,
          r.designation,
          r.work_location,
          r.department_name,
          r.company_short,
          r.company_code,
        ].some((v) =>
          String(v ?? '')
            .toLowerCase()
            .includes(term),
        ),
      );
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av =
        sortKey === 'name'
          ? String(a.display_name || a.name || '')
          : String((a as Record<string, unknown>)[sortKey] ?? '');
      const bv =
        sortKey === 'name'
          ? String(b.display_name || b.name || '')
          : String((b as Record<string, unknown>)[sortKey] ?? '');

      if (sortKey === 'staff_id' || sortKey === 'epf_number') {
        const an = Number(av.replace(/\D/g, ''));
        const bn = Number(bv.replace(/\D/g, ''));
        if (!Number.isNaN(an) && !Number.isNaN(bn) && av.replace(/\D/g, '') && bv.replace(/\D/g, '')) {
          return (an - bn) * dir;
        }
      }
      return av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true }) * dir;
    });
  }, [rows, q, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const from = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, filtered.length);

  function changePageSize(size: PageSize) {
    setPageSize(size);
    setPage(1);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      /* ignore */
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  }

  function openAdd() {
    setEditEmp(null);
    setAdding(true);
    const defaultCo = company === 'ALL' ? 'IT' : company;
    setForm({ ...emptyForm(), company: defaultCo });
  }

  function openEdit(emp: Employee) {
    setAdding(false);
    setEditEmp(emp);
    setForm({
      company: (emp.company_code === 'IMS' || emp.company_code === 'ISP' ? emp.company_code : 'IT') as
        | 'IT'
        | 'IMS'
        | 'ISP',
      staff_id: emp.staff_id ?? '',
      name: emp.name ?? '',
      title: emp.title || '',
      epf_number: emp.epf_number ?? '',
      employment_status: emp.employment_status || 'Current',
      designation: emp.designation ?? '',
      work_location: emp.work_location ?? '',
      department_name: emp.department_name ?? '',
    });
  }

  function closeForm() {
    setAdding(false);
    setEditEmp(null);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      if (adding) {
        await api('/api/employees', {
          method: 'POST',
          body: JSON.stringify({ ...form, company: form.company }),
        });
        toast.success('Employee added');
      } else if (editEmp) {
        await api(`/api/employees/${editEmp.id}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        });
        toast.success('Employee updated');
      }
      closeForm();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/employees/${deleteTarget.id}`, { method: 'DELETE' });
      toast.success('Employee removed');
      setDeleteTarget(null);
      if (viewEmp?.id === deleteTarget.id) setViewEmp(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  const filtersActive = Boolean(q.trim() || status || company !== 'ALL');

  return (
    <>
      <div className="asset-filter-panel">
        <div className="asset-filter-grid">
          <label className="asset-filter-field">
            <span className="asset-filter-label">Search</span>
            <input
              className="asset-filter-control"
              placeholder="Search by name, staff ID, EPF, designation…"
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
            <span className="asset-filter-label">Status</span>
            <select
              className="asset-filter-control"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="Current">Current</option>
              <option value="Probation">Probation</option>
              <option value="Former">Former</option>
            </select>
          </label>
        </div>
        <div className="asset-filter-footer">
          <p className="asset-filter-count">
            {loading ? (
              'Loading…'
            ) : (
              <>
                Showing{' '}
                <strong>
                  {filtered.length === 0 ? '0' : `${from}–${to}`}
                </strong>{' '}
                of <strong>{filtered.length}</strong> employee
                {filtered.length === 1 ? '' : 's'}
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
                setStatus('');
                setCompany('ALL');
                setPage(1);
              }}
            >
              Clear filters
            </button>
            {canManage ? (
              <button type="button" className="btn btn-primary" onClick={openAdd}>
                + Add employee
              </button>
            ) : null}
            <TableSettingsMenu
              pageSize={pageSize}
              onPageSizeChange={changePageSize}
              onRefresh={() => void load()}
              refreshing={loading}
              rangeLabel={
                filtered.length === 0 ? '0 of 0' : `${from} - ${to} of ${filtered.length}`
              }
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
          <LoadingSkeleton rows={10} />
        ) : error ? (
          <ErrorState description={error} onRetry={() => void load()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No employees found" description="Try another filter or clear the search." />
        ) : (
          <table className="table org-table">
            <thead>
              <tr>
                <th className="org-col-num">#</th>
                <th>
                  <SortHeader label="Staff ID" active={sortKey === 'staff_id'} dir={sortDir} onClick={() => toggleSort('staff_id')} />
                </th>
                <th>
                  <SortHeader label="Name" active={sortKey === 'name'} dir={sortDir} onClick={() => toggleSort('name')} />
                </th>
                <th>
                  <SortHeader label="EPF" active={sortKey === 'epf_number'} dir={sortDir} onClick={() => toggleSort('epf_number')} />
                </th>
                <th>
                  <SortHeader
                    label="Designation"
                    active={sortKey === 'designation'}
                    dir={sortDir}
                    onClick={() => toggleSort('designation')}
                  />
                </th>
                <th>
                  <SortHeader
                    label="Location"
                    active={sortKey === 'work_location'}
                    dir={sortDir}
                    onClick={() => toggleSort('work_location')}
                  />
                </th>
                <th>
                  <SortHeader
                    label="Department"
                    active={sortKey === 'department_name'}
                    dir={sortDir}
                    onClick={() => toggleSort('department_name')}
                  />
                </th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => (
                <tr key={r.id}>
                  <td className="org-col-num muted">{(safePage - 1) * pageSize + i + 1}</td>
                  <td>{r.staff_id}</td>
                  <td>
                    <strong className="org-emp-name">{r.display_name || r.name}</strong>
                  </td>
                  <td>{dash(r.epf_number)}</td>
                  <td>{dash(r.designation)}</td>
                  <td>{dash(r.work_location)}</td>
                  <td>{dash(r.department_name)}</td>
                  <td>
                    <span className={`org-status-pill ${statusTone(r.employment_status)}`}>
                      <span className="org-status-dot" aria-hidden />
                      {statusLabel(r.employment_status)}
                    </span>
                  </td>
                  <td>
                    <ActionsMenu
                      onView={() => setViewEmp(r)}
                      onUpdate={() => openEdit(r)}
                      onDelete={() => setDeleteTarget(r)}
                      deleteDisabled={!canManage}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableShell>

      <Modal
        open={!!viewEmp}
        title="Employee details"
        eyebrow={viewEmp?.company_short || viewEmp?.company_code || 'Organization'}
        onClose={() => setViewEmp(null)}
        footer={
          <>
            <button type="button" className="btn btn-soft" onClick={() => setViewEmp(null)}>
              Close
            </button>
            {canManage && viewEmp ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const emp = viewEmp;
                  setViewEmp(null);
                  openEdit(emp);
                }}
              >
                Update
              </button>
            ) : null}
          </>
        }
      >
        {viewEmp ? (
          <dl className="org-detail-dl">
            <div>
              <dt>Staff ID</dt>
              <dd>{viewEmp.staff_id}</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{viewEmp.display_name || viewEmp.name}</dd>
            </div>
            <div>
              <dt>EPF</dt>
              <dd>{dash(viewEmp.epf_number)}</dd>
            </div>
            <div>
              <dt>Designation</dt>
              <dd>{dash(viewEmp.designation)}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{dash(viewEmp.work_location)}</dd>
            </div>
            <div>
              <dt>Department</dt>
              <dd>{dash(viewEmp.department_name)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{viewEmp.employment_status || '—'}</dd>
            </div>
            <div>
              <dt>Company</dt>
              <dd>{viewEmp.company_name || viewEmp.company_short || viewEmp.company_code || '—'}</dd>
            </div>
          </dl>
        ) : null}
      </Modal>

      <Modal
        open={formOpen}
        title={adding ? 'Add employee' : 'Update employee'}
        eyebrow={
          adding
            ? COMPANY_FILTERS.find((t) => t.id === form.company)?.label || form.company
            : editEmp?.display_name || editEmp?.name || 'Employee'
        }
        onClose={closeForm}
        footer={
          <>
            <button type="button" className="btn btn-soft" disabled={saving} onClick={closeForm}>
              Cancel
            </button>
            <button type="submit" form="org-edit-form" className="btn btn-primary" disabled={saving || !canManage}>
              {saving ? 'Saving…' : adding ? 'Add employee' : 'Save'}
            </button>
          </>
        }
      >
        <p className="org-form-hint">
          Only <strong>Name</strong> is required. Leave anything else blank if you don’t know it yet
          {adding ? ' — Staff ID is auto-assigned when empty' : ''}.
        </p>
        <form id="org-edit-form" className="form-grid" onSubmit={(e) => void onSave(e)}>
          {adding ? (
            <label>
              Company *
              <select
                className="select"
                required
                value={form.company}
                onChange={(e) =>
                  setForm({ ...form, company: e.target.value as 'IT' | 'IMS' | 'ISP' })
                }
              >
                <option value="IT">ITL</option>
                <option value="IMS">IMS</option>
                <option value="ISP">ISP</option>
              </select>
            </label>
          ) : null}
          <label>
            Title
            <select className="select" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}>
              <option value="">—</option>
              <option value="Mr">Mr</option>
              <option value="Ms">Ms</option>
              <option value="Mrs">Mrs</option>
            </select>
          </label>
          <label>
            Staff ID{adding ? '' : ' *'}
            <input
              className="input"
              required={!adding}
              placeholder={adding ? 'Optional — auto if blank' : undefined}
              value={form.staff_id}
              onChange={(e) => setForm({ ...form, staff_id: e.target.value })}
            />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Name *
            <input
              className="input"
              required
              placeholder="Full name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            EPF
            <input
              className="input"
              placeholder="Optional"
              value={form.epf_number}
              onChange={(e) => setForm({ ...form, epf_number: e.target.value })}
            />
          </label>
          <label>
            Status
            <select
              className="select"
              value={form.employment_status}
              onChange={(e) => setForm({ ...form, employment_status: e.target.value })}
            >
              <option value="Current">Current</option>
              <option value="Probation">Probation</option>
              <option value="Former">Former</option>
            </select>
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Designation
            <input
              className="input"
              placeholder="Optional"
              value={form.designation}
              onChange={(e) => setForm({ ...form, designation: e.target.value })}
            />
          </label>
          <label>
            Location
            <input
              className="input"
              placeholder="Optional"
              value={form.work_location}
              onChange={(e) => setForm({ ...form, work_location: e.target.value })}
            />
          </label>
          <label>
            Department
            <input
              className="input"
              placeholder="Optional"
              value={form.department_name}
              onChange={(e) => setForm({ ...form, department_name: e.target.value })}
            />
          </label>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove employee?"
        message={`Remove ${deleteTarget?.display_name || deleteTarget?.name || 'this employee'} from the organization directory?`}
        confirmLabel="Remove"
        danger
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void onDelete()}
      />
    </>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
}) {
  return (
    <button type="button" className={`org-sort-btn${active ? ' active' : ''}`} onClick={onClick}>
      {label}
      <span className="org-sort-icons" aria-hidden>
        <span className={active && dir === 'asc' ? 'on' : ''}>▲</span>
        <span className={active && dir === 'desc' ? 'on' : ''}>▼</span>
      </span>
    </button>
  );
}

function IconUsers(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconPin(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M12 22s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function IconOrg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <rect x="9" y="2" width="6" height="5" rx="1" />
      <rect x="2" y="16" width="6" height="5" rx="1" />
      <rect x="16" y="16" width="6" height="5" rx="1" />
      <path d="M12 7v4M5 16v-2a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v2" />
    </svg>
  );
}

const ORG_DIRECTORY_CSS = `
  .org-directory .page-header { margin-bottom: 1rem; }
  .org-section-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
    margin-bottom: 1.1rem;
  }
  .org-section-tab-count {
    margin-left: 0.15rem;
    min-width: 1.4rem;
    padding: 0.08rem 0.42rem;
    border-radius: 999px;
    background: #e2e8f0;
    color: #334155;
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 1.2;
    text-align: center;
  }
  .org-section-tab.active .org-section-tab-count {
    background: rgba(255, 255, 255, 0.22);
    color: #fff;
  }
  .org-section-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.55rem 1rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: #fff;
    color: var(--text);
    font-size: 0.9rem;
    font-weight: 600;
    text-decoration: none;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .org-section-tab:hover {
    border-color: #93c5fd;
    color: #1d4ed8;
  }
  .org-section-tab.active {
    background: #2563eb;
    border-color: #2563eb;
    color: #fff;
    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.28);
  }
  .org-section-tab-icon {
    display: inline-flex;
    line-height: 0;
  }
  .org-table {
    width: 100%;
    border-collapse: collapse;
  }
  .org-table thead th {
    font-size: 0.78rem;
    font-weight: 700;
    color: #64748b;
    text-transform: none;
    letter-spacing: 0;
    border-bottom: 1px solid var(--border);
    padding: 0.75rem 0.65rem;
    white-space: nowrap;
    background: transparent;
  }
  .org-table tbody td {
    padding: 0.85rem 0.65rem;
    border-bottom: 1px solid #eef2f7;
    font-size: 0.9rem;
    vertical-align: middle;
  }
  .org-table tbody tr:hover td {
    background: #f8fafc;
  }
  .org-col-num {
    width: 2.5rem;
    color: #94a3b8;
    font-variant-numeric: tabular-nums;
  }
  .org-emp-name {
    font-weight: 600;
    color: #0f172a;
  }
  .org-sort-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 0;
    background: transparent;
    padding: 0;
    font: inherit;
    font-weight: 700;
    color: inherit;
    cursor: pointer;
  }
  .org-sort-btn.active { color: #1d4ed8; }
  .org-sort-icons {
    display: inline-flex;
    flex-direction: column;
    font-size: 0.55rem;
    line-height: 0.7;
    color: #cbd5e1;
  }
  .org-sort-icons .on { color: #2563eb; }
  .org-status-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.28rem 0.7rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .org-status-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: currentColor;
  }
  .org-status-pill.current {
    background: #dcfce7;
    color: #15803d;
  }
  .org-status-pill.probation {
    background: #fef3c7;
    color: #b45309;
  }
  .org-status-pill.former {
    background: #fee2e2;
    color: #b91c1c;
  }
  .org-status-pill.other {
    background: #e2e8f0;
    color: #475569;
  }
  .org-form-hint {
    margin: 0 0 0.85rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .org-detail-dl {
    margin: 0;
    display: grid;
    gap: 0.55rem;
  }
  .org-detail-dl > div {
    display: grid;
    grid-template-columns: 7.5rem 1fr;
    gap: 0.5rem;
    font-size: 0.92rem;
  }
  .org-detail-dl dt {
    margin: 0;
    color: var(--muted);
    font-weight: 600;
  }
  .org-detail-dl dd {
    margin: 0;
    word-break: break-word;
  }
  .muted { color: #94a3b8; }
`;
