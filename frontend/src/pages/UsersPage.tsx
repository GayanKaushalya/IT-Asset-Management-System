import { FormEvent, useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/ui/PageHeader';
import StatusBadge from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import { DataTableShell } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';
import PaginationBar from '../components/ui/PaginationBar';
import TableSettingsMenu, { type PageSize } from '../components/ui/TableSettingsMenu';
import { api } from '../services/client';
import { useAuth } from '../auth/AuthContext';

const PAGE_SIZE_KEY = 'itams.users.pageSize';

function readStoredPageSize(): PageSize {
  try {
    const raw = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (raw === 5 || raw === 10 || raw === 20 || raw === 50 || raw === 100 || raw === 500) return raw;
  } catch {
    /* ignore */
  }
  return 10;
}

type UserRow = {
  id: number;
  name?: string;
  email?: string;
  staff_id?: string;
  role?: string;
  company_short?: string;
  company_id?: number;
  is_active?: boolean | string | number;
  can_decrypt_vault?: boolean | string | number;
  last_login_at?: string | null;
};

type Company = { id: number; code: string; name: string; short_name: string };

type Props = {
  /** When true, omit outer page chrome (used inside Settings hub). */
  embedded?: boolean;
};

function isActive(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 't' || v === 'true';
}

function formatWhen(value?: string | null): string {
  if (!value) return 'Never';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

const ROLE_OPTIONS = [
  { value: 'it_staff', label: 'IT Staff' },
  { value: 'it_admin', label: 'IT Admin' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'employee', label: 'Employee' },
  { value: 'super_admin', label: 'Super Admin' },
];

export default function UsersPage({ embedded = false }: Props) {
  const { user: me } = useAuth();
  const canManage = me?.role === 'super_admin' || me?.role === 'it_admin';

  const [rows, setRows] = useState<UserRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(() => readStoredPageSize());
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    staff_id: '',
    role: 'it_staff',
    company_id: '',
    password: '',
  });
  const [editForm, setEditForm] = useState({
    role: 'it_staff',
    is_active: true,
    can_decrypt_vault: false,
  });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [usersRes, companiesRes] = await Promise.all([
        api<{ data: UserRow[] }>('/api/users'),
        api<{ data: Company[] }>('/api/companies'),
      ]);
      setRows(usersRes.data ?? []);
      setCompanies(companiesRes.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const onVis = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      ['name', 'email', 'staff_id', 'role'].some((k) => String((r as Record<string, unknown>)[k] ?? '').toLowerCase().includes(term)),
    );
  }, [rows, q]);

  useEffect(() => {
    setPage(1);
  }, [q, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);
  const rangeFrom = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeTo = Math.min(safePage * pageSize, filtered.length);

  function changePageSize(size: PageSize) {
    setPageSize(size);
    setPage(1);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      /* ignore */
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          staff_id: form.staff_id,
          role: form.role,
          company_id: form.company_id ? Number(form.company_id) : undefined,
          password: form.password || undefined,
        }),
      });
      setShowAdd(false);
      setForm({ name: '', email: '', staff_id: '', role: 'it_staff', company_id: '', password: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(row: UserRow) {
    setEditUser(row);
    setEditForm({
      role: String(row.role ?? 'it_staff'),
      is_active: isActive(row.is_active),
      can_decrypt_vault: isActive(row.can_decrypt_vault),
    });
    setError('');
  }

  async function onUpdate(e: FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/users/${editUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          role: editForm.role,
          is_active: editForm.is_active,
          can_decrypt_vault: editForm.can_decrypt_vault,
        }),
      });
      setEditUser(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  const body = (
    <>
      {!embedded ? (
        <PageHeader
          title="Users"
          subtitle="Grant access and change access type (role) for IT staff"
          actions={
            canManage ? (
              <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
                + Add User
              </button>
            ) : undefined
          }
        />
      ) : null}

      <DataTableShell
        toolbar={
          <div className="toolbar" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input"
              placeholder="Search users…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: '12rem', flex: 1 }}
            />
            <span style={{ color: 'var(--muted)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
              {filtered.length === 0
                ? '0 users'
                : `${rangeFrom}–${rangeTo} of ${filtered.length} user${filtered.length === 1 ? '' : 's'}`}
            </span>
            {embedded && canManage ? (
              <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
                + Add User
              </button>
            ) : null}
            <TableSettingsMenu
              pageSize={pageSize}
              onPageSizeChange={changePageSize}
              onRefresh={() => void load()}
              refreshing={loading}
              rangeLabel={
                filtered.length === 0 ? '0 of 0' : `${rangeFrom} - ${rangeTo} of ${filtered.length}`
              }
            />
            <PaginationBar
              page={safePage}
              totalPages={totalPages}
              onPageChange={setPage}
              disabled={loading || filtered.length === 0}
            />
          </div>
        }
      >
        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : error && rows.length === 0 ? (
          <ErrorState description={error} onRetry={() => void load()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No users found" description="Add an IT user to get started." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Staff ID</th>
                <th>Access type</th>
                <th>Company</th>
                <th>Last login</th>
                <th>Status</th>
                {canManage ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((r) => (
                <tr key={String(r.id)}>
                  <td>{String(r.name ?? '—')}</td>
                  <td>{String(r.email ?? '—')}</td>
                  <td>{String(r.staff_id ?? '—')}</td>
                  <td style={{ textTransform: 'capitalize' }}>{String(r.role ?? '').replace(/_/g, ' ')}</td>
                  <td>{String(r.company_short ?? '—')}</td>
                  <td>{formatWhen(r.last_login_at)}</td>
                  <td>
                    <StatusBadge status={isActive(r.is_active) ? 'active' : 'inactive'} />
                  </td>
                  {canManage ? (
                    <td>
                      <button type="button" className="btn btn-soft" onClick={() => openEdit(r)}>
                        Manage access
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableShell>

      <Modal
        open={showAdd}
        title="Add user"
        eyebrow="Organization"
        onClose={() => setShowAdd(false)}
        footer={
          <>
            <button type="button" className="btn btn-soft" disabled={saving} onClick={() => setShowAdd(false)}>
              Cancel
            </button>
            <button type="submit" form="add-user-form" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Create user'}
            </button>
          </>
        }
      >
        <form id="add-user-form" className="form-grid" onSubmit={(e) => void onCreate(e)}>
          <label>
            Name *
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Email *
            <input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>
            Staff ID *
            <input className="input" required value={form.staff_id} onChange={(e) => setForm({ ...form, staff_id: e.target.value })} />
          </label>
          <label>
            Access type
            <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLE_OPTIONS.filter((o) => me?.role === 'super_admin' || o.value !== 'super_admin').map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Company
            <select className="select" value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
              <option value="">Default</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.short_name} ({c.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Temporary password
            <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          {error ? <p className="error-text" style={{ gridColumn: '1 / -1' }}>{error}</p> : null}
        </form>
      </Modal>

      <Modal
        open={!!editUser}
        title="Manage access"
        eyebrow={editUser?.email ?? 'User'}
        onClose={() => setEditUser(null)}
        footer={
          <>
            <button type="button" className="btn btn-soft" disabled={saving} onClick={() => setEditUser(null)}>
              Cancel
            </button>
            <button type="submit" form="edit-user-form" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save access'}
            </button>
          </>
        }
      >
        {editUser ? (
          <form id="edit-user-form" className="form-grid" onSubmit={(e) => void onUpdate(e)}>
            <label style={{ gridColumn: '1 / -1' }}>
              User
              <input className="input" readOnly value={`${editUser.name ?? ''} (${editUser.email ?? ''})`} />
            </label>
            <label>
              Access type
              <select
                className="select"
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
              >
                {ROLE_OPTIONS.filter((o) => me?.role === 'super_admin' || o.value !== 'super_admin').map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Account status
              <select
                className="select"
                value={editForm.is_active ? '1' : '0'}
                onChange={(e) => setEditForm({ ...editForm, is_active: e.target.value === '1' })}
              >
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </label>
            <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={editForm.can_decrypt_vault}
                onChange={(e) => setEditForm({ ...editForm, can_decrypt_vault: e.target.checked })}
              />
              Can decrypt credential vault
            </label>
            <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: '0.85rem', opacity: 0.75 }}>
              Changes are recorded in System → Audit Logs. Deactivating a user ends their active sessions.
            </p>
            {error ? <p className="error-text" style={{ gridColumn: '1 / -1' }}>{error}</p> : null}
          </form>
        ) : null}
      </Modal>
    </>
  );

  if (embedded) return body;
  return <main className="page page--fill">{body}</main>;
}
