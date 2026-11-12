import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import ActionsMenu from '../components/ActionsMenu';
import { ConfirmDialog } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import PageHeader from '../components/ui/PageHeader';
import PaginationBar from '../components/ui/PaginationBar';
import StatusBadge from '../components/ui/StatusBadge';
import TableSettingsMenu, { type PageSize } from '../components/ui/TableSettingsMenu';
import { api } from '../services/client';
import { getOrgMeta } from '../services/metaCache';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ui/Toast';
import { copyToClipboard } from '../utils/clipboard';

function EyeIcon({ open }: { open: boolean }): ReactNode {
  if (open) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CopyIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

const PAGE_SIZE_KEY = 'itams.credentials.pageSize';

function readStoredPageSize(): PageSize {
  try {
    const raw = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (raw === 5 || raw === 10 || raw === 20 || raw === 50 || raw === 100 || raw === 500) return raw;
  } catch {
    /* ignore */
  }
  return 10;
}
type Row = Record<string, unknown>;
type Company = { id: number; code: string; short_name: string; name: string };
type Loc = { id: number; company_id: number; name: string; city?: string | null };

type MainTab = 'emails' | 'wifi';
type CompanyTab = 'IT' | 'IMS' | 'ISP' | 'FOTON' | 'OTHER';

const SECTION_FROM_PATH: Record<string, MainTab> = {
  emails: 'emails',
  wifi: 'wifi',
};

const COMPANY_TABS: { id: CompanyTab; label: string }[] = [
  { id: 'IT', label: 'ITL' },
  { id: 'IMS', label: 'IMS' },
  { id: 'ISP', label: 'ISP' },
  { id: 'FOTON', label: 'Foton' },
  { id: 'OTHER', label: 'Others' },
];

const EMAIL_DOMAINS: Partial<Record<CompanyTab, string>> = {
  IT: 'indratraders.lk',
  IMS: 'indramotorspares.com',
  ISP: 'indraservicepark.lk',
  FOTON: 'fotontrucks.lk',
};

function emailLocalPart(value: string): string {
  const trimmed = value.trim();
  const at = trimmed.indexOf('@');
  return (at >= 0 ? trimmed.slice(0, at) : trimmed).replace(/\s+/g, '');
}

function dash(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function pickStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function hasPassword(r: Row): boolean {
  return r.has_password === true || r.has_password === 't' || r.has_password === 1;
}

function PasswordCell({
  rowId,
  revealed,
  hasPw,
}: {
  rowId: number;
  revealed: Record<number, string>;
  hasPw: boolean;
}) {
  if (!hasPw) {
    return <span style={{ color: 'var(--muted)', fontWeight: 650 }}>N/A</span>;
  }
  if (revealed[rowId]) {
    return <code style={{ color: 'var(--primary)', fontWeight: 650 }}>{revealed[rowId]}</code>;
  }
  return <span style={{ letterSpacing: '0.12em', color: 'var(--muted)' }}>••••••••</span>;
}

function VaultStatusBadge({ hasPw }: { hasPw: boolean }) {
  if (!hasPw) {
    return <StatusBadge label="N/A" tone="na" />;
  }
  return <StatusBadge label="Secured" tone="secured" />;
}

export default function CredentialsPage() {
  const { section } = useParams();
  const mainTab = SECTION_FROM_PATH[section ?? ''];
  const { user } = useAuth();
  const toast = useToast();
  const [companyTab, setCompanyTab] = useState<CompanyTab>('IT');
  const [rows, setRows] = useState<Row[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<Loc[]>([]);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [pendingReveal, setPendingReveal] = useState<{
    kind: 'email' | 'wifi';
    id: number;
    label: string;
    userName?: string;
    email?: string;
    wifiName?: string;
  } | null>(null);
  const [revealPopup, setRevealPopup] = useState<{
    kind: 'email' | 'wifi';
    userName?: string;
    email?: string;
    wifiName?: string;
    password: string;
  } | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);
  const revealHideTimer = useRef<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingEmailUserId, setEditingEmailUserId] = useState<number | null>(null);
  const [editingWifiId, setEditingWifiId] = useState<number | null>(null);
  const [editingEmailId, setEditingEmailId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [existingEmailHint, setExistingEmailHint] = useState(false);
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  /** Live vault value shown read-only; edit field stays empty unless user types a new password. */
  const [currentVaultPassword, setCurrentVaultPassword] = useState<string | null>(null);
  const [form, setForm] = useState({
    username: '',
    email_local: '',
    email_full: '',
    company_code: 'IT' as CompanyTab,
    location_id: '',
    password: '',
    wifi_name: '',
  });
  const [listLoading, setListLoading] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>(() => readStoredPageSize());
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [filterLocationId, setFilterLocationId] = useState('');
  const loadSeq = useRef(0);

  /** WiFi has no "Others" tab — never request OTHER for wifi (avoids error flash). */
  const listCompany: CompanyTab =
    mainTab === 'wifi' && companyTab === 'OTHER' ? 'IT' : companyTab;

  const activeCompany = useMemo(
    () => companies.find((c) => c.code === listCompany) ?? null,
    [companies, listCompany],
  );

  const companyLocations = useMemo(
    () => (activeCompany ? locations.filter((l) => Number(l.company_id) === activeCompany.id) : []),
    [locations, activeCompany],
  );

  const formCompany = useMemo(() => {
    const code = form.company_code === 'OTHER' ? 'IT' : form.company_code;
    return companies.find((c) => c.code === code) ?? activeCompany;
  }, [companies, form.company_code, activeCompany]);

  const formLocations = useMemo(
    () => (formCompany ? locations.filter((l) => Number(l.company_id) === formCompany.id) : []),
    [locations, formCompany],
  );

  const wifiCompanyOptions = useMemo(
    () => COMPANY_TABS.filter((t) => t.id !== 'OTHER'),
    [],
  );

  const isOtherTab = companyTab === 'OTHER';
  const emailDomain = EMAIL_DOMAINS[companyTab] ?? '';
  const isEditing = editingEmailUserId !== null || editingWifiId !== null;

  const filteredRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterLocationId) {
        if (String(r.location_id ?? '') !== filterLocationId) return false;
      }
      if (!term) return true;
      if (mainTab === 'emails') {
        return [r.user_name, r.email_address, r.location_name, r.location_city]
          .some((v) => String(v ?? '').toLowerCase().includes(term));
      }
      return [r.system_name, r.username, r.location_name, r.location_city, r.password_hint, r.company_code]
        .some((v) => String(v ?? '').toLowerCase().includes(term));
    });
  }, [rows, q, mainTab, filterLocationId]);

  const totalRows = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  const emailsMissingFields =
    mainTab === 'emails' &&
    rows.length > 0 &&
    rows.every((r) => !pickStr(r.email_address) && !pickStr(r.emailAddress) && !pickStr(r.email));

  const canReveal =
    !!user?.can_decrypt_vault || user?.role === 'super_admin' || user?.role === 'it_admin';

  async function load(opts?: { silent?: boolean }) {
    if (!mainTab) return;
    if (mainTab === 'wifi' && companyTab === 'OTHER') return;

    const seq = ++loadSeq.current;
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setListLoading(true);
      setError('');
      setRows([]);
      setRevealed({});
    }
    try {
      const companyCode = mainTab === 'wifi' && companyTab === 'OTHER' ? 'IT' : companyTab;
      const metaPromise = getOrgMeta();
      const listPromise =
        mainTab === 'emails'
          ? api<{ data?: Row[] }>(
              `/api/email-accounts?${new URLSearchParams({ company_code: companyCode }).toString()}`,
              { cache: 'no-store' },
            )
          : api<{ data?: Row[] }>(
              `/api/credentials?${new URLSearchParams({
                credential_type: 'wifi',
                company_code: companyCode,
              }).toString()}`,
              { cache: 'no-store' },
            );

      const [meta, list] = await Promise.all([metaPromise, listPromise]);
      if (seq !== loadSeq.current) return;

      setCompanies(meta.companies);
      setLocations(meta.locations);
      const raw = Array.isArray(list?.data) ? list.data : [];
      // Normalize snake_case / camelCase so columns never render as blank dashes
      setRows(
        raw.map((r) => {
          const email =
            pickStr(r.email_address) ||
            pickStr(r.emailAddress) ||
            pickStr(r.email);
          const userName = pickStr(r.user_name) || pickStr(r.userName);
          const locationName =
            pickStr(r.location_name) ||
            pickStr(r.locationName) ||
            pickStr(r.password_hint);
          return {
            ...r,
            user_row_id: r.user_row_id ?? r.userRowId ?? r.id,
            email_id: r.email_id ?? r.emailId,
            user_name: userName,
            email_address: email,
            location_name: locationName,
            location_city: pickStr(r.location_city) || pickStr(r.locationCity),
            location_id: r.location_id ?? r.locationId,
            company_code: pickStr(r.company_code) || pickStr(r.companyCode),
            company_id: r.company_id ?? r.companyId,
            system_name: pickStr(r.system_name) || pickStr(r.systemName),
            has_password: r.has_password ?? r.hasPassword,
            password_updated_at: r.password_updated_at ?? r.passwordUpdatedAt,
            password_updated_by_name:
              pickStr(r.password_updated_by_name) || pickStr(r.passwordUpdatedByName),
          };
        }),
      );
      // Always drop in-memory revealed values so another admin's update is not shown as stale.
      setRevealed({});
      setError('');
    } catch (e) {
      if (seq !== loadSeq.current) return;
      if (silent) return;
      const msg = e instanceof Error ? e.message : 'Failed to load credentials';
      setError(msg);
      toast.error(msg);
    } finally {
      if (seq === loadSeq.current && !silent) {
        setListLoading(false);
      }
    }
  }

  function changePageSize(size: PageSize) {
    setPageSize(size);
    setPage(1);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (mainTab === 'wifi' && companyTab === 'OTHER') {
      setCompanyTab('IT');
      return;
    }
    setPage(1);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, companyTab]);

  useEffect(() => {
    setPage(1);
  }, [q, filterLocationId]);

  useEffect(() => {
    setFilterLocationId('');
    setQ('');
  }, [mainTab, companyTab]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Keep lists fresh when returning to the tab / window
  useEffect(() => {
    const onFocus = () => void load({ silent: true });
    const onVis = () => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, companyTab]);

  useEffect(() => {
    if (!showModal || mainTab !== 'emails' || !activeCompany || isEditing) {
      setExistingEmailHint(false);
      return;
    }
    const full = (
      isOtherTab
        ? form.email_full.trim()
        : form.email_local
          ? `${emailLocalPart(form.email_local)}@${emailDomain}`
          : ''
    ).toLowerCase();
    if (!full.includes('@')) {
      setExistingEmailHint(false);
      return;
    }
    const exists = rows.some((r) => String(r.email_address ?? '').toLowerCase() === full);
    setExistingEmailHint(exists);
  }, [form.email_local, form.email_full, emailDomain, isOtherTab, rows, showModal, mainTab, activeCompany, isEditing]);

  if (!mainTab) {
    return <Navigate to="/credentials/emails" replace />;
  }

  function emptyForm(locationId = '', companyCode: CompanyTab = listCompany) {
    return {
      username: '',
      email_local: '',
      email_full: '',
      company_code: companyCode === 'OTHER' ? 'IT' : companyCode,
      location_id: locationId,
      password: '',
      wifi_name: '',
    };
  }

  function closeModal() {
    setShowModal(false);
    setEditingEmailUserId(null);
    setEditingWifiId(null);
    setEditingEmailId(null);
    setShowFormPassword(false);
    setPasswordLoading(false);
    setCurrentVaultPassword(null);
    setForm(emptyForm());
  }

  async function copyPassword(value: string) {
    if (!value) {
      toast.error('Nothing to copy');
      return;
    }
    const ok = await copyToClipboard(value);
    if (ok) toast.success('Password copied');
    else toast.error('Could not copy password — select the password and press Ctrl+C');
  }

  function openAdd() {
    setError('');
    setEditingEmailUserId(null);
    setEditingWifiId(null);
    setEditingEmailId(null);
    setShowFormPassword(false);
    setCurrentVaultPassword(null);
    const firstLoc = companyLocations[0];
    setForm(emptyForm(firstLoc ? String(firstLoc.id) : ''));
    setShowModal(true);
  }

  async function openEditEmail(r: Row) {
    setError('');
    setEditingEmailUserId(Number(r.user_row_id));
    const emailId = Number(r.email_id);
    setEditingEmailId(emailId);
    setEditingWifiId(null);
    setShowFormPassword(false);
    setCurrentVaultPassword(null);
    const email = String(r.email_address ?? '');
    // Leave password blank on edit so browser autofill / stale values cannot overwrite
    // another admin's newer password when Save is clicked.
    setForm({
      username: String(r.user_name ?? ''),
      email_local: emailLocalPart(email),
      email_full: email,
      company_code: listCompany,
      location_id: r.location_id != null ? String(r.location_id) : '',
      password: '',
      wifi_name: '',
    });
    setShowModal(true);
  }

  async function openEditWifi(r: Row) {
    setError('');
    const wifiId = Number(r.id);
    setEditingWifiId(wifiId);
    setEditingEmailUserId(null);
    setEditingEmailId(null);
    setShowFormPassword(false);
    setCurrentVaultPassword(null);
    const codeRaw = String(r.company_code ?? listCompany).toUpperCase();
    const companyCode = (['IT', 'IMS', 'ISP', 'FOTON'].includes(codeRaw)
      ? codeRaw
      : listCompany) as CompanyTab;
    setForm({
      ...emptyForm(
        r.location_id != null ? String(r.location_id) : '',
        companyCode,
      ),
      wifi_name: String(r.system_name ?? ''),
      password: '',
    });
    setShowModal(true);
  }

  async function loadCurrentPasswordIntoForm() {
    if (!user?.can_decrypt_vault) {
      toast.error('Not authorized to reveal vault passwords');
      return;
    }
    const kind = mainTab === 'emails' ? 'email' : 'wifi';
    const id = kind === 'email' ? editingEmailId : editingWifiId;
    if (id == null) return;
    setPasswordLoading(true);
    try {
      const data =
        kind === 'email'
          ? await api<{ password: string }>(`/api/email-accounts/${id}/reveal`, { method: 'POST' })
          : await api<{ password: string }>(`/api/credentials/${id}/reveal`, { method: 'POST' });
      const password = data.password ?? '';
      setCurrentVaultPassword(password);
      // Do not put into the editable field — typing a new password is intentional only.
      setShowFormPassword(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not load current password';
      toast.error(msg);
    } finally {
      setPasswordLoading(false);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    try {
      if (mainTab === 'emails') {
        if (!activeCompany) {
          toast.error('Company not ready yet — wait a moment and try again');
          return;
        }
        const personName = form.username.trim();
        const fullEmail = (
          isOtherTab
            ? form.email_full.trim()
            : form.email_local
              ? `${emailLocalPart(form.email_local)}@${emailDomain}`
              : ''
        ).toLowerCase();
        if (!fullEmail || !fullEmail.includes('@')) {
          toast.error(isOtherTab ? 'Enter the full email address' : 'Enter the email name (before @)');
          return;
        }
        if (!form.location_id) {
          toast.error('Select a location');
          return;
        }

        if (editingEmailUserId !== null) {
          const payload: Record<string, unknown> = {
            user_name: personName,
            email_address: fullEmail,
            location_id: Number(form.location_id),
          };
          if (form.password.trim() !== '') {
            payload.password = form.password;
          }
          await api(`/api/email-accounts/users/${editingEmailUserId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
        } else {
          const payload: Record<string, unknown> = {
            company_id: activeCompany.id,
            user_name: personName,
            email_address: fullEmail,
            location_id: Number(form.location_id),
            password: form.password,
          };
          await api('/api/email-accounts', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        }
      } else if (editingWifiId !== null) {
        if (!formCompany) {
          toast.error('Company not ready yet — wait a moment and try again');
          return;
        }
        if (!form.location_id) {
          toast.error('Select a location');
          return;
        }
        if (!form.wifi_name.trim()) {
          toast.error('Enter the network / SSID');
          return;
        }
        const payload: Record<string, unknown> = {
          system_name: form.wifi_name.trim(),
          company_id: formCompany.id,
          location_id: Number(form.location_id),
        };
        if (form.password.trim() !== '') {
          payload.password = form.password;
        }
        await api(`/api/credentials/${editingWifiId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (form.company_code !== listCompany) {
          setCompanyTab(form.company_code === 'OTHER' ? 'IT' : form.company_code);
        }
      } else {
        if (!formCompany) {
          toast.error('Company not ready yet — wait a moment and try again');
          return;
        }
        if (!form.location_id) {
          toast.error('Select a location');
          return;
        }
        if (!form.wifi_name.trim()) {
          toast.error('Enter the network / SSID');
          return;
        }
        await api('/api/credentials', {
          method: 'POST',
          body: JSON.stringify({
            company_id: formCompany.id,
            location_id: Number(form.location_id),
            credential_type: 'wifi',
            system_name: form.wifi_name.trim(),
            username: 'wifi',
            password: form.password,
          }),
        });
        if (form.company_code !== listCompany) {
          setCompanyTab(form.company_code === 'OTHER' ? 'IT' : form.company_code);
        }
      }

      closeModal();
      setRevealed({});
      toast.success(isEditing ? 'Updated successfully' : 'Saved successfully');
      await load({ silent: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error(msg);
    }
  }

  async function onDeleteEmail(r: Row) {
    const name = String(r.user_name ?? '');
    const email = String(r.email_address ?? '');
    if (!window.confirm(`Delete ${name} from ${email}?`)) return;
    const id = Number(r.user_row_id);
    setDeletingId(id);
    try {
      await api(`/api/email-accounts/users/${id}`, { method: 'DELETE' });
      toast.success('Email account deleted');
      await load({ silent: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      toast.error(msg);
    } finally {
      setDeletingId(null);
    }
  }

  async function onDeleteWifi(r: Row) {
    const name = String(r.system_name ?? '');
    if (!window.confirm(`Delete WiFi password for ${name}?`)) return;
    const id = Number(r.id);
    setDeletingId(id);
    try {
      await api(`/api/credentials/${id}`, { method: 'DELETE' });
      toast.success('WiFi password deleted');
      await load({ silent: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      toast.error(msg);
    } finally {
      setDeletingId(null);
    }
  }

  function scheduleRevealHide(id: number) {
    if (revealHideTimer.current != null) {
      window.clearTimeout(revealHideTimer.current);
    }
    revealHideTimer.current = window.setTimeout(() => {
      setRevealed((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
      setRevealPopup(null);
      revealHideTimer.current = null;
    }, 10000);
  }

  function closeRevealPopup() {
    if (revealHideTimer.current != null) {
      window.clearTimeout(revealHideTimer.current);
      revealHideTimer.current = null;
    }
    setRevealPopup(null);
  }

  async function confirmReveal() {
    if (!pendingReveal) return;
    setRevealBusy(true);
    setError('');
    try {
      if (pendingReveal.kind === 'email') {
        const data = await api<{ password: string }>(
          `/api/email-accounts/${pendingReveal.id}/reveal`,
          { method: 'POST' },
        );
        const password = data.password ?? '';
        setRevealed((r) => ({ ...r, [pendingReveal.id]: password }));
        setRevealPopup({
          kind: 'email',
          userName: pendingReveal.userName || '—',
          email: pendingReveal.email || pendingReveal.label,
          password,
        });
        scheduleRevealHide(pendingReveal.id);
      } else {
        const data = await api<{ password: string }>(
          `/api/credentials/${pendingReveal.id}/reveal`,
          { method: 'POST' },
        );
        const password = data.password ?? '';
        setRevealed((r) => ({ ...r, [pendingReveal.id]: password }));
        setRevealPopup({
          kind: 'wifi',
          wifiName: pendingReveal.wifiName || pendingReveal.label,
          password,
        });
        scheduleRevealHide(pendingReveal.id);
      }
      setPendingReveal(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reveal failed';
      toast.error(msg);
    } finally {
      setRevealBusy(false);
    }
  }

  const title = mainTab === 'emails' ? 'Credential Vault' : 'WiFi Passwords';
  const addLabel = mainTab === 'emails' ? 'Add email user' : 'Add WiFi password';
  const modalTitle = isEditing
    ? mainTab === 'emails'
      ? 'Update email user'
      : 'Update WiFi password'
    : addLabel;

  const rangeFrom = totalRows === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeTo = Math.min(safePage * pageSize, totalRows);
  const companyTabs =
    mainTab === 'emails' ? COMPANY_TABS : COMPANY_TABS.filter((t) => t.id !== 'OTHER');

  return (
    <main className="page page--fill">
      <PageHeader
        eyebrow="Credential Management"
        title={title}
        subtitle={
          mainTab === 'emails'
            ? 'Encrypted shared mailboxes. Reveal is audited and auto-hides after 10 seconds.'
            : 'Encrypted WiFi credentials. Reveal is audited and auto-hides after 10 seconds.'
        }
      />
      {error ? <p className="error-text">{error}</p> : null}
      {emailsMissingFields ? (
        <p className="error-text">
          Email addresses did not load into the table. Switch company tab or reopen this page to reload.
        </p>
      ) : null}

      <div className="tabs-secondary company-tabs-row">
        {companyTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab-btn${companyTab === tab.id ? ' active' : ''}`}
            onClick={() => setCompanyTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <button type="button" className="btn btn-primary company-tabs-add" onClick={openAdd}>
          + {addLabel}
        </button>
      </div>

      <div className="card asset-list-card">
        <div className="asset-filter-panel">
          <div
            className="asset-filter-grid"
            style={{
              gridTemplateColumns:
                mainTab === 'wifi'
                  ? 'minmax(12rem, 1.2fr) minmax(10rem, 0.9fr)'
                  : 'minmax(0,1fr)',
            }}
          >
            <label className="asset-filter-field">
              <span className="asset-filter-label">Search</span>
              <input
                className="asset-filter-control"
                placeholder={
                  mainTab === 'emails'
                    ? 'Search user / email / location'
                    : 'Search network / SSID / location'
                }
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                aria-label="Search credentials"
              />
            </label>
            {mainTab === 'wifi' ? (
              <label className="asset-filter-field">
                <span className="asset-filter-label">Location</span>
                <select
                  className="asset-filter-control"
                  value={filterLocationId}
                  onChange={(e) => {
                    setFilterLocationId(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All locations</option>
                  {companyLocations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.city ? ` (${l.city})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div className="asset-filter-footer">
            <p className="asset-filter-count">
              {listLoading ? (
                'Loading…'
              ) : (
                <>
                  Showing <strong>{totalRows === 0 ? '0' : `${rangeFrom}–${rangeTo}`}</strong> of{' '}
                  <strong>{totalRows}</strong>{' '}
                  {mainTab === 'emails' ? 'account' : 'network'}
                  {totalRows === 1 ? '' : 's'}
                </>
              )}
            </p>
            <div className="asset-filter-actions">
              <button
                type="button"
                className="asset-filter-clear"
                disabled={!q.trim() && !filterLocationId}
                onClick={() => {
                  setQ('');
                  setFilterLocationId('');
                  setPage(1);
                }}
              >
                Clear filters
              </button>
              <TableSettingsMenu
                pageSize={pageSize}
                onPageSizeChange={changePageSize}
                onRefresh={() => void load()}
                refreshing={listLoading}
                rangeLabel={
                  totalRows === 0 ? '0 of 0' : `${rangeFrom} - ${rangeTo} of ${totalRows}`
                }
              />
              <PaginationBar
                page={safePage}
                totalPages={totalPages}
                onPageChange={setPage}
                disabled={listLoading}
              />
            </div>
          </div>
        </div>
        <div
          className={`asset-table-scroll${
            pageSize === 10 && pagedRows.length >= 10 ? ' asset-table-scroll--fit-10' : ''
          }`}
          style={
            pageSize === 10 && pagedRows.length >= 10
              ? ({
                  ['--asset-visible-rows']: String(Math.max(pagedRows.length, 1)),
                } as CSSProperties)
              : undefined
          }
        >
          <table className="table asset-data-table">
            <thead>
              <tr>
                {mainTab === 'emails' ? (
                  <>
                    <th>User name</th>
                    <th>Email</th>
                    <th>Location</th>
                    <th>Password</th>
                    <th>Last updated</th>
                    <th>Status</th>
                    <th></th>
                  </>
                ) : (
                  <>
                    <th>Network / SSID</th>
                    <th>Company</th>
                    <th>Location</th>
                    <th>Password</th>
                    <th>Status</th>
                    <th></th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={mainTab === 'emails' ? 7 : 6}>
                    <EmptyState
                      title={mainTab === 'emails' ? 'No email accounts found' : 'No WiFi passwords found'}
                      description="Add a vault entry for this company tab."
                      action={
                        <button type="button" className="btn btn-primary" onClick={openAdd}>
                          + {addLabel}
                        </button>
                      }
                    />
                  </td>
                </tr>
              ) : (
                pagedRows.map((r) => {
                  if (mainTab === 'emails') {
                    const emailId = Number(r.email_id);
                    const rowKey = Number(r.user_row_id);
                    const hasPw = hasPassword(r);
                    const userName = pickStr(r.user_name) || pickStr(r.userName);
                    const email = pickStr(r.email_address) || pickStr(r.emailAddress) || pickStr(r.email);
                    const location = pickStr(r.location_name) || pickStr(r.locationName);
                    const updatedBy = pickStr(r.password_updated_by_name);
                    const updatedAt = pickStr(r.password_updated_at);
                    return (
                      <tr key={rowKey}>
                        <td>{dash(userName)}</td>
                        <td><code style={{ fontSize: '0.85rem' }}>{dash(email)}</code></td>
                        <td>{dash(location)}</td>
                        <td>
                          <PasswordCell rowId={emailId} revealed={revealed} hasPw={hasPw} />
                        </td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--muted)', maxWidth: 140 }}>
                          {updatedBy || updatedAt ? (
                            <>
                              {updatedBy ? <div>{updatedBy}</div> : null}
                              {updatedAt ? (
                                <div>{new Date(updatedAt).toLocaleString()}</div>
                              ) : null}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td><VaultStatusBadge hasPw={hasPw} /></td>
                        <td>
                          <ActionsMenu
                            viewLabel="Reveal"
                            onView={() =>
                              setPendingReveal({
                                kind: 'email',
                                id: emailId,
                                label: email || 'mailbox',
                                userName,
                                email,
                              })
                            }
                            onUpdate={() => void openEditEmail(r)}
                            onDelete={() => void onDeleteEmail(r)}
                            viewDisabled={!canReveal}
                            deleteBusy={deletingId === rowKey}
                          />
                        </td>
                      </tr>
                    );
                  }

                  const id = Number(r.id);
                  const hasPw = hasPassword(r);
                  const wifiCompanyCode = String(r.company_code ?? listCompany).toUpperCase();
                  const wifiCompanyLabel =
                    COMPANY_TABS.find((t) => t.id === wifiCompanyCode)?.label ?? wifiCompanyCode;
                  const wifiLocation =
                    pickStr(r.location_name) ||
                    pickStr(r.password_hint) ||
                    '';
                  return (
                    <tr key={id}>
                      <td>
                        <strong>{dash(r.system_name)}</strong>
                        {r.username && String(r.username) !== 'wifi' && String(r.username).toLowerCase() !== 'undefined' ? (
                          <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.78rem' }}>
                            {dash(r.username)}
                          </span>
                        ) : null}
                      </td>
                      <td>{dash(wifiCompanyLabel)}</td>
                      <td style={{ maxWidth: 220, fontSize: '0.86rem' }}>
                        {dash(wifiLocation)}
                        {pickStr(r.location_city) ? (
                          <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.78rem' }}>
                            {pickStr(r.location_city)}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <PasswordCell rowId={id} revealed={revealed} hasPw={hasPw} />
                      </td>
                      <td><VaultStatusBadge hasPw={hasPw} /></td>
                      <td>
                        <ActionsMenu
                          viewLabel="Reveal"
                          onView={() =>
                            setPendingReveal({
                              kind: 'wifi',
                              id,
                              label: String(r.system_name ?? 'WiFi'),
                              wifiName: String(r.system_name ?? ''),
                              userName: r.username && String(r.username) !== 'wifi' ? String(r.username) : undefined,
                              email: wifiLocation || undefined,
                            })
                          }
                          onUpdate={() => void openEditWifi(r)}
                          onDelete={() => void onDeleteWifi(r)}
                          viewDisabled={!canReveal}
                          deleteBusy={deletingId === id}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingReveal}
        title="Reveal sensitive credential?"
        message={`You are about to reveal the password for “${pendingReveal?.label ?? ''}”. This action is audited. The popup will close automatically after 10 seconds.`}
        confirmLabel="Reveal password"
        danger
        busy={revealBusy}
        onCancel={() => setPendingReveal(null)}
        onConfirm={() => void confirmReveal()}
      />

      {revealPopup ? (
        <div className="modal-backdrop" onClick={closeRevealPopup}>
          <div className="modal-card reveal-popup" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>
                  Revealed credential
                </p>
                <h3 style={{ margin: '0.2rem 0 0' }}>
                  {revealPopup.kind === 'email' ? 'Email account' : 'WiFi password'}
                </h3>
              </div>
              <button type="button" className="btn btn-soft" onClick={closeRevealPopup}>
                Hide
              </button>
            </div>
            <div className="reveal-grid">
              {revealPopup.kind === 'email' ? (
                <>
                  <div className="reveal-item">
                    <span>User name</span>
                    <strong>{revealPopup.userName || '—'}</strong>
                  </div>
                  <div className="reveal-item">
                    <span>Email</span>
                    <strong>
                      <code>{revealPopup.email || '—'}</code>
                    </strong>
                  </div>
                </>
              ) : (
                <>
                  {revealPopup.userName ? (
                    <div className="reveal-item">
                      <span>Flow / area</span>
                      <strong>{revealPopup.userName}</strong>
                    </div>
                  ) : null}
                  <div className="reveal-item">
                    <span>Network / SSID</span>
                    <strong>{revealPopup.wifiName || '—'}</strong>
                  </div>
                  {revealPopup.email ? (
                    <div className="reveal-item">
                      <span>Location</span>
                      <strong>{revealPopup.email}</strong>
                    </div>
                  ) : null}
                </>
              )}
              <div className="reveal-item password">
                <span>Password</span>
                <div className="reveal-password-row">
                  <strong>
                    {revealPopup.password ? (
                      <code>{revealPopup.password}</code>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontWeight: 700 }}>N/A</span>
                    )}
                  </strong>
                  {revealPopup.password ? (
                    <button
                      type="button"
                      className="btn btn-soft btn-sm copy-btn"
                      onClick={() => void copyPassword(revealPopup.password)}
                      title="Copy password"
                    >
                      <CopyIcon />
                      Copy
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            <p style={{ margin: '0.85rem 0 0', color: 'var(--muted)', fontSize: '0.82rem' }}>
              This popup closes automatically in 10 seconds.
            </p>
          </div>
        </div>
      ) : null}

      {showModal ? (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3 style={{ margin: 0 }}>{modalTitle}</h3>
                <p style={{ margin: '0.35rem 0 0', color: 'var(--muted)', fontSize: '0.9rem' }}>
                  {mainTab === 'wifi'
                    ? 'Choose company and location for this network'
                    : `Company: ${COMPANY_TABS.find((t) => t.id === companyTab)?.label ?? companyTab}`}
                </p>
              </div>
              <button type="button" className="btn btn-soft" onClick={closeModal}>
                Close
              </button>
            </div>

            <form onSubmit={(e) => void onSave(e)}>
              <div className="form-grid">
                {mainTab === 'emails' ? (
                  <>
                    <input
                      className="input"
                      required
                      placeholder="User name"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                    />
                    {isOtherTab ? (
                      <input
                        className="input"
                        required
                        type="email"
                        placeholder="email@gmail.com / yahoo.com / …"
                        value={form.email_full}
                        onChange={(e) => setForm({ ...form, email_full: e.target.value })}
                        aria-label="Full email address"
                      />
                    ) : (
                      <div className="email-compose">
                        <input
                          className="input"
                          required
                          placeholder="name"
                          value={form.email_local}
                          onChange={(e) => setForm({ ...form, email_local: emailLocalPart(e.target.value) })}
                          aria-label="Email local part"
                        />
                        <span className="email-domain">@{emailDomain}</span>
                      </div>
                    )}
                    <select
                      className="select"
                      required
                      value={form.location_id}
                      onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                    >
                      <option value="">Select location</option>
                      {companyLocations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}{l.city ? ` (${l.city})` : ''}
                        </option>
                      ))}
                    </select>
                    {isEditing && canReveal ? (
                      <div className="current-password-box">
                        <div className="current-password-row">
                          <span className="hint-inline" style={{ margin: 0 }}>
                            Current vault password
                          </span>
                          <button
                            type="button"
                            className="btn btn-soft"
                            style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                            onClick={() => void loadCurrentPasswordIntoForm()}
                            disabled={passwordLoading}
                          >
                            {passwordLoading ? 'Loading…' : currentVaultPassword != null ? 'Refresh' : 'Show current'}
                          </button>
                        </div>
                        {currentVaultPassword != null ? (
                          <div className="reveal-password-row" style={{ marginTop: '0.35rem' }}>
                            <strong>
                              {currentVaultPassword ? (
                                <code>{currentVaultPassword}</code>
                              ) : (
                                <span style={{ color: 'var(--muted)' }}>(empty)</span>
                              )}
                            </strong>
                            {currentVaultPassword ? (
                              <button
                                type="button"
                                className="password-toggle"
                                onClick={() => void copyPassword(currentVaultPassword)}
                                title="Copy current password"
                              >
                                <CopyIcon />
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <p className="hint-inline" style={{ marginTop: '0.25rem' }}>
                            Click “Show current” to read the live password from the server (not a cached copy).
                          </p>
                        )}
                      </div>
                    ) : null}
                    <div className="password-field with-actions">
                      <input
                        className="input"
                        type={showFormPassword ? 'text' : 'password'}
                        minLength={isEditing || existingEmailHint ? undefined : 8}
                        required={false}
                        placeholder={
                          isEditing || existingEmailHint
                            ? 'New password (leave blank to keep current)'
                            : 'Password (optional)'
                        }
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        autoComplete="new-password"
                        name="itams-vault-new-password"
                      />
                      <div className="password-actions">
                        {showFormPassword && form.password ? (
                          <button
                            type="button"
                            className="password-toggle"
                            onClick={() => void copyPassword(form.password)}
                            aria-label="Copy password"
                            title="Copy password"
                          >
                            <CopyIcon />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="password-toggle"
                          onClick={() => setShowFormPassword((v) => !v)}
                          aria-label={showFormPassword ? 'Hide password' : 'Show password'}
                          title={showFormPassword ? 'Hide password' : 'Show password'}
                        >
                          <EyeIcon open={showFormPassword} />
                        </button>
                      </div>
                    </div>
                    {!isEditing && existingEmailHint ? (
                      <p className="hint-inline">
                        This email already exists — saving will add another user to the same shared mailbox password.
                      </p>
                    ) : null}
                    {isEditing && editingEmailId !== null ? (
                      <p className="hint-inline">
                        Password changes apply to every user profile on this mailbox for all admins.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <select
                      className="select"
                      required
                      value={form.company_code}
                      onChange={(e) => {
                        const next = e.target.value as CompanyTab;
                        const nextCompany = companies.find((c) => c.code === next);
                        const nextLocs = nextCompany
                          ? locations.filter((l) => Number(l.company_id) === nextCompany.id)
                          : [];
                        const keepLoc = nextLocs.some((l) => String(l.id) === form.location_id);
                        setForm({
                          ...form,
                          company_code: next,
                          location_id: keepLoc
                            ? form.location_id
                            : nextLocs[0]
                              ? String(nextLocs[0].id)
                              : '',
                        });
                      }}
                      aria-label="Company"
                    >
                      {wifiCompanyOptions.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="select"
                      required
                      value={form.location_id}
                      onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                      aria-label="Location"
                    >
                      <option value="">Select location</option>
                      {formLocations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                          {l.city ? ` (${l.city})` : ''}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input"
                      required
                      placeholder="Network / SSID"
                      value={form.wifi_name}
                      onChange={(e) => setForm({ ...form, wifi_name: e.target.value })}
                    />
                    {isEditing && canReveal ? (
                      <div className="current-password-box">
                        <div className="current-password-row">
                          <span className="hint-inline" style={{ margin: 0 }}>
                            Current vault password
                          </span>
                          <button
                            type="button"
                            className="btn btn-soft"
                            style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                            onClick={() => void loadCurrentPasswordIntoForm()}
                            disabled={passwordLoading}
                          >
                            {passwordLoading ? 'Loading…' : currentVaultPassword != null ? 'Refresh' : 'Show current'}
                          </button>
                        </div>
                        {currentVaultPassword != null ? (
                          <div className="reveal-password-row" style={{ marginTop: '0.35rem' }}>
                            <strong>
                              {currentVaultPassword ? (
                                <code>{currentVaultPassword}</code>
                              ) : (
                                <span style={{ color: 'var(--muted)' }}>(empty)</span>
                              )}
                            </strong>
                            {currentVaultPassword ? (
                              <button
                                type="button"
                                className="password-toggle"
                                onClick={() => void copyPassword(currentVaultPassword)}
                                title="Copy current password"
                              >
                                <CopyIcon />
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="password-field with-actions">
                      <input
                        className="input"
                        type={showFormPassword ? 'text' : 'password'}
                        minLength={isEditing ? undefined : 4}
                        required={!isEditing}
                        placeholder={
                          isEditing ? 'New password (leave blank to keep current)' : 'Password'
                        }
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        autoComplete="new-password"
                        name="itams-wifi-new-password"
                      />
                      <div className="password-actions">
                        {showFormPassword && form.password ? (
                          <button
                            type="button"
                            className="password-toggle"
                            onClick={() => void copyPassword(form.password)}
                            aria-label="Copy password"
                            title="Copy password"
                          >
                            <CopyIcon />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="password-toggle"
                          onClick={() => setShowFormPassword((v) => !v)}
                          aria-label={showFormPassword ? 'Hide password' : 'Show password'}
                          title={showFormPassword ? 'Hide password' : 'Show password'}
                        >
                          <EyeIcon open={showFormPassword} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button type="button" className="btn btn-soft" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {isEditing ? 'Update' : 'Encrypt & save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <style>{`
        .company-tabs-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.45rem;
        }
        .company-tabs-add {
          margin-left: auto;
        }
        .email-compose {
          display: flex; align-items: center; gap: 0.35rem; grid-column: 1 / -1;
        }
        .email-compose .input { flex: 1; min-width: 0; }
        .email-domain {
          flex-shrink: 0; color: var(--muted); font-weight: 650; font-size: 0.92rem;
          white-space: nowrap;
        }
        .hint-inline {
          grid-column: 1 / -1; margin: 0; color: var(--muted); font-size: 0.86rem;
        }
        .current-password-box {
          grid-column: 1 / -1;
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0.65rem 0.8rem;
          background: #f8fafc;
        }
        .current-password-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .modal-backdrop {
          position: fixed; inset: 0; background: rgba(17,24,39,0.45);
          display: grid; place-items: center; padding: 1rem; z-index: 50;
        }
        .modal-card {
          width: min(560px, 100%); max-height: 90vh; overflow: auto;
          background: #fff; border-radius: 16px; padding: 1.25rem 1.35rem;
          box-shadow: 0 24px 60px rgba(17,24,39,0.35);
        }
        .modal-head {
          display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start;
          margin-bottom: 1rem;
        }
        .reveal-popup { width: min(440px, 100%); }
        .reveal-grid {
          display: grid; gap: 0.65rem;
        }
        .reveal-item {
          border: 1px solid var(--border); border-radius: 10px;
          padding: 0.65rem 0.8rem; background: #f8fafc;
          display: grid; gap: 0.2rem;
        }
        .reveal-item span {
          font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em;
          text-transform: uppercase; color: var(--muted);
        }
        .reveal-item strong { font-size: 0.98rem; word-break: break-all; }
        .reveal-item.password {
          border-color: #86efac; background: #f0fdf4;
        }
        .reveal-item.password code {
          color: #166534; font-size: 1.05rem; font-weight: 700;
        }
        .reveal-password-row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 0.75rem; flex-wrap: wrap;
        }
        .reveal-password-row strong { min-width: 0; word-break: break-all; }
        .copy-btn {
          display: inline-flex; align-items: center; gap: 0.35rem;
          padding: 0.35rem 0.7rem; font-size: 0.82rem; flex-shrink: 0;
        }
        .password-field.with-actions {
          position: relative; display: flex; align-items: center;
          grid-column: 1 / -1;
        }
        .password-field.with-actions .input {
          width: 100%; padding-right: 5.25rem;
        }
        .password-actions {
          position: absolute; right: 0.3rem; display: inline-flex;
          align-items: center; gap: 0.05rem;
        }
        .password-actions .password-toggle {
          position: static;
        }
      `}</style>
    </main>
  );
}
