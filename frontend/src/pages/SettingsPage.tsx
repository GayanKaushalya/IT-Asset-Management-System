import { FormEvent, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  canCreateBackup,
  canViewBackups,
  canWrite,
  isAudit,
  isSuperAdmin,
} from '../auth/permissions';
import PageHeader from '../components/ui/PageHeader';
import StatusBadge from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import { DataTableShell } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
import { api, downloadAuthenticated, setSession, getToken, type AuthUser } from '../services/client';
import { getOrgMeta } from '../services/metaCache';
import UsersPage from './UsersPage';

type Section =
  | 'account'
  | 'users'
  | 'companies'
  | 'backups'
  | 'audit';

const BASE_SECTIONS: { id: Section; label: string; hint: string; auditOnly?: boolean }[] = [
  { id: 'account', label: 'Account', hint: 'Your profile and password' },
  { id: 'users', label: 'Users', hint: 'IT staff and system access' },
  { id: 'companies', label: 'Companies', hint: 'Operating companies' },
  { id: 'backups', label: 'Backups', hint: 'Create and restore system data backups' },
  {
    id: 'audit',
    label: 'Audit export',
    hint: 'Export full mobile phone inventory to Excel',
    auditOnly: true,
  },
];

type Row = Record<string, unknown>;

function dash(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v);
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { section: raw } = useParams();
  const section = (raw ?? 'account') as Section;

  const sections = useMemo(
    () => BASE_SECTIONS.filter((s) => !s.auditOnly || isAudit(user)),
    [user],
  );
  const sectionIds = useMemo(() => new Set(sections.map((s) => s.id)), [sections]);

  if (!sectionIds.has(section)) {
    return <Navigate to="/settings/account" replace />;
  }

  const active = sections.find((s) => s.id === section)!;

  return (
    <main className="page page--fill">
      <PageHeader
        eyebrow="System"
        title="Settings"
        subtitle={active.hint}
      />

      <div className="tabs-secondary" style={{ marginBottom: '1.1rem' }}>
        {sections.map((s) => (
          <NavLink
            key={s.id}
            to={`/settings/${s.id}`}
            className={({ isActive }) => `tab-btn${isActive ? ' active' : ''}`}
            style={{ textDecoration: 'none' }}
          >
            {s.label}
          </NavLink>
        ))}
      </div>

      {section === 'account' ? <AccountPanel /> : null}
      {section === 'users' ? <UsersPage embedded /> : null}
      {section === 'companies' ? (
        <MetaPanel
          title="Companies"
          endpoint="/api/companies"
          columns={[
            { key: 'code', label: 'Code' },
            { key: 'short_name', label: 'Short name' },
            { key: 'name', label: 'Name' },
          ]}
        />
      ) : null}
      {section === 'backups' ? <BackupsPanel /> : null}
      {section === 'audit' && isAudit(user) ? <AuditExportPanel /> : null}
    </main>
  );
}

function AuditExportPanel() {
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  async function exportMobilePhones() {
    setExporting(true);
    try {
      await downloadAuthenticated(
        '/api/audit/mobile-phones-export',
        `itams-mobile-phones-${new Date().toISOString().slice(0, 10)}.xls`,
      );
      toast.success('Mobile phone Excel export downloaded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="card" style={{ padding: '1.25rem 1.35rem' }}>
      <h3 style={{ marginTop: 0, marginBottom: '0.35rem' }}>Mobile phones — full export</h3>
      <p style={{ color: 'var(--muted)', marginTop: 0, maxWidth: '40rem', fontSize: '0.92rem' }}>
        Download every mobile phone record across all companies — both new stock and old stock —
        with asset ID, holders, first assigned user, handover chain, IMEI, serial, location,
        warranty, and accessories. A Stock type column marks each row as New or Old. SIM cards
        are excluded.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        disabled={exporting}
        onClick={() => void exportMobilePhones()}
      >
        {exporting ? 'Preparing Excel…' : 'Export mobile phones to Excel'}
      </button>
    </section>
  );
}

type BackupRow = {
  file: string;
  bytes: number;
  created_at?: string | null;
  total_rows?: number | null;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

function formatWhen(value?: string | null): string {
  if (!value) return 'â€”';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function BackupsPanel() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = canViewBackups(user);
  const canCreate = canCreateBackup(user);
  const isSuper = isSuperAdmin(user) && canWrite(user);

  const [rows, setRows] = useState<BackupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyFile, setBusyFile] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null);
  const [uploading, setUploading] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await api<{ data: BackupRow[] }>('/api/backups');
      setRows(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load backups');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAdmin) void load();
    else {
      setLoading(false);
      setError('Only IT admins can manage backups');
    }
  }, [isAdmin]);

  async function createBackup() {
    setCreating(true);
    try {
      const res = await api<{ message?: string; data: BackupRow }>('/api/backups', { method: 'POST' });
      toast.success(res.message || 'Backup created');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Backup failed');
    } finally {
      setCreating(false);
    }
  }

  async function downloadBackup(file: string) {
    setBusyFile(file);
    try {
      await downloadAuthenticated(`/api/backups/download?file=${encodeURIComponent(file)}`, file);
      toast.success('Download started');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusyFile('');
    }
  }

  async function confirmRestore() {
    if (!restoreTarget) return;
    setBusyFile(restoreTarget.file);
    try {
      const res = await api<{ message?: string }>('/api/backups/restore', {
        method: 'POST',
        body: JSON.stringify({ file: restoreTarget.file }),
      });
      setRestoreTarget(null);
      toast.success(res.message || 'Restore complete â€” sign in again if needed');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setBusyFile('');
    }
  }

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.sql')) {
      toast.error('Only .sql backup files are allowed');
      return;
    }
    if (!window.confirm(`Restore database from uploaded file "${file.name}"?\n\nThis replaces current data. Continue?`)) {
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await api<{ message?: string }>('/api/backups/restore-upload', {
        method: 'POST',
        body,
      });
      toast.success(res.message || 'Restore complete â€” sign in again if needed');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload restore failed');
    } finally {
      setUploading(false);
    }
  }

  if (!isAdmin) {
    return (
      <EmptyState
        title="Backups restricted"
        description="Ask a super admin or IT admin to create and restore system backups."
      />
    );
  }

  return (
    <>
      <section className="card" style={{ padding: '1.1rem 1.25rem', marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0, marginBottom: '0.35rem' }}>System backups</h3>
        <p style={{ color: 'var(--muted)', marginTop: 0, fontSize: '0.9rem', maxWidth: '48rem' }}>
          Create a full database snapshot you can download and restore later if data is lost.
          Encrypted vault passwords stay encrypted â€” keep the same vault key in{' '}
          <code>backend/config/config.php</code> after restore.
        </p>
        <div className="toolbar" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          {canCreate ? (
          <button type="button" className="btn btn-primary" disabled={creating} onClick={() => void createBackup()}>
            {creating ? 'Creating backup…' : 'Create backup now'}
          </button>
          ) : isAudit(user) ? (
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>
              Audit access is view-only — you can download existing backups.
            </p>
          ) : null}
          {isSuper ? (
            <label className="btn btn-soft" style={{ cursor: uploading ? 'wait' : 'pointer', margin: 0 }}>
              {uploading ? 'Restoring uploadâ€¦' : 'Restore from fileâ€¦'}
              <input
                type="file"
                accept=".sql,application/sql,text/plain"
                hidden
                disabled={uploading}
                onChange={(ev) => void onUpload(ev)}
              />
            </label>
          ) : null}
        </div>
      </section>

      <DataTableShell>
        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : error ? (
          <ErrorState description={error} onRetry={() => void load()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No backups yet"
            description="Click â€œCreate backup nowâ€ to save a recoverable snapshot of the system."
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Created</th>
                <th>File</th>
                <th>Size</th>
                <th>Rows</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.file}>
                  <td>{formatWhen(r.created_at)}</td>
                  <td style={{ wordBreak: 'break-all' }}>{r.file}</td>
                  <td>{formatBytes(r.bytes ?? 0)}</td>
                  <td>{r.total_rows != null ? r.total_rows : 'â€”'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-soft"
                        disabled={busyFile === r.file}
                        onClick={() => void downloadBackup(r.file)}
                      >
                        Download
                      </button>
                      {isSuper ? (
                        <button
                          type="button"
                          className="btn btn-soft"
                          disabled={!!busyFile}
                          onClick={() => setRestoreTarget(r)}
                        >
                          Restore
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableShell>

      <Modal
        open={!!restoreTarget}
        title="Restore backup?"
        eyebrow="Destructive action"
        onClose={() => setRestoreTarget(null)}
        footer={
          <>
            <button type="button" className="btn btn-soft" disabled={!!busyFile} onClick={() => setRestoreTarget(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!!busyFile} onClick={() => void confirmRestore()}>
              {busyFile ? 'Restoringâ€¦' : 'Yes, restore database'}
            </button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          This will replace the current database with:
        </p>
        <p style={{ fontWeight: 600, wordBreak: 'break-all' }}>{restoreTarget?.file}</p>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
          Active sessions may be cleared. Keep a download of a recent backup before restoring an older one.
        </p>
      </Modal>
    </>
  );
}

function AccountPanel() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState({ name: '', phone: '' });
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [companyLabel, setCompanyLabel] = useState('â€”');

  useEffect(() => {
    setProfile({
      name: user?.name ?? '',
      phone: (user as AuthUser & { phone?: string | null })?.phone ?? '',
    });
  }, [user]);

  useEffect(() => {
    void getOrgMeta()
      .then((meta) => {
        const c = meta.companies?.find((x) => Number(x.id) === Number(user?.company_id));
        setCompanyLabel(c ? `${c.short_name || c.name} (${c.code})` : 'â€”');
      })
      .catch(() => setCompanyLabel('â€”'));
  }, [user?.company_id]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await api<{ user: AuthUser }>('/api/me', {
        method: 'PUT',
        body: JSON.stringify({ name: profile.name, phone: profile.phone }),
      });
      const token = getToken();
      if (token && res.user) {
        setSession(token, res.user);
        refreshUser(res.user);
      }
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update profile');
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (pwd.next.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }
    if (pwd.next !== pwd.confirm) {
      toast.error('New password confirmation does not match');
      return;
    }
    setSavingPwd(true);
    try {
      await api('/api/me/password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: pwd.current,
          new_password: pwd.next,
          confirm_password: pwd.confirm,
        }),
      });
      setPwd({ current: '', next: '', confirm: '' });
      toast.success('Password updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update password');
    } finally {
      setSavingPwd(false);
    }
  }

  if (!user) return null;

  return (
    <div className="settings-grid">
      <section className="card settings-card">
        <h3 style={{ marginTop: 0 }}>Profile</h3>
        <p style={{ color: 'var(--muted)', marginTop: 0, fontSize: '0.9rem' }}>
          Email and role are managed by administrators.
        </p>
        <dl className="settings-dl">
          <div>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Staff ID</dt>
            <dd>{user.staff_id || 'â€”'}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd style={{ textTransform: 'capitalize' }}>{String(user.role).replace(/_/g, ' ')}</dd>
          </div>
          <div>
            <dt>Company</dt>
            <dd>{companyLabel}</dd>
          </div>
        </dl>
        <form className="form-grid" onSubmit={(e) => void saveProfile(e)} style={{ marginTop: '1rem' }}>
          <label>
            Display name
            <input
              className="input"
              required
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </label>
          <label>
            Phone
            <input
              className="input"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              placeholder="Optional"
            />
          </label>
          <div style={{ gridColumn: '1 / -1' }}>
            <button type="submit" className="btn btn-primary" disabled={savingProfile}>
              {savingProfile ? 'Savingâ€¦' : 'Save profile'}
            </button>
          </div>
        </form>
      </section>

      <section className="card settings-card">
        <h3 style={{ marginTop: 0 }}>Change password</h3>
        <p style={{ color: 'var(--muted)', marginTop: 0, fontSize: '0.9rem' }}>
          Use at least 6 characters. Leave current blank only if you never set a password.
        </p>
        <form className="form-grid" onSubmit={(e) => void savePassword(e)}>
          <label style={{ gridColumn: '1 / -1' }}>
            Current password
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={pwd.current}
              onChange={(e) => setPwd({ ...pwd, current: e.target.value })}
            />
          </label>
          <label>
            New password
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={pwd.next}
              onChange={(e) => setPwd({ ...pwd, next: e.target.value })}
            />
          </label>
          <label>
            Confirm new password
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={pwd.confirm}
              onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
            />
          </label>
          <div style={{ gridColumn: '1 / -1' }}>
            <button type="submit" className="btn btn-primary" disabled={savingPwd}>
              {savingPwd ? 'Updatingâ€¦' : 'Update password'}
            </button>
          </div>
        </form>
      </section>

      <style>{`
        .settings-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1rem;
        }
        .settings-card { padding: 1.15rem 1.25rem; }
        .settings-dl {
          display: grid;
          gap: 0.65rem;
          margin: 0;
        }
        .settings-dl > div {
          display: grid;
          grid-template-columns: 7rem 1fr;
          gap: 0.5rem;
          align-items: baseline;
        }
        .settings-dl dt {
          margin: 0;
          color: var(--muted);
          font-size: 0.82rem;
          font-weight: 600;
        }
        .settings-dl dd { margin: 0; }
      `}</style>
    </div>
  );
}

function MetaPanel({
  title,
  endpoint,
  columns,
  toolbarExtra,
}: {
  title: string;
  endpoint: string;
  columns: { key: string; label: string }[];
  toolbarExtra?: ReactNode;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await api<{ data: Row[] }>(endpoint);
      setRows(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [endpoint]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(term)),
    );
  }, [rows, q, columns]);

  return (
    <DataTableShell
      toolbar={
        <div className="toolbar" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder={`Search ${title.toLowerCase()}â€¦`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: '12rem', flex: 1 }}
          />
          {toolbarExtra}
        </div>
      }
    >
      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : error ? (
        <ErrorState title={`Unable to load ${title.toLowerCase()}`} description={error} onRetry={() => void load()} />
      ) : filtered.length === 0 ? (
        <EmptyState title={`No ${title.toLowerCase()} found`} description="Try adjusting your search or add a new entry." />
      ) : (
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={String(r.id)}>
                {columns.map((c) => (
                  <td key={c.key}>{dash(r[c.key])}</td>
                ))}
                <td>
                  <StatusBadge status="active" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DataTableShell>
  );
}
