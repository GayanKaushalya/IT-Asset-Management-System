import { FormEvent, useEffect, useRef, useState, type ReactNode } from 'react';
import ActionsMenu from '../components/ActionsMenu';
import { useAuth } from '../auth/AuthContext';
import StatusBadge from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import { DataTableShell } from '../components/ui/DataTable';
import PaginationBar from '../components/ui/PaginationBar';
import TableSettingsMenu, { type PageSize } from '../components/ui/TableSettingsMenu';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
import { api, downloadAuthenticated } from '../services/client';
import { DATE_INPUT_MIN as DATE_MIN } from '../lib/dateInput';
import AgreementHistoryTimeline from './AgreementHistoryTimeline';

type CompanyTab = 'ALL' | 'IT' | 'IMS' | 'ISP';
type AgreementType = 'software' | 'hardware' | 'networking';
type AgreementStatus = 'active' | 'expiring' | 'expired' | 'cancelled' | 'draft';

type Agreement = {
  id: number;
  company_id?: number | null;
  company_code?: string | null;
  company_short?: string | null;
  company_label?: string;
  agreement_type: AgreementType;
  type_label?: string;
  vendor_name: string;
  title: string;
  contract_ref?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  renewal_date?: string | null;
  auto_renewing?: boolean;
  status: AgreementStatus | string;
  value_amount?: number | string | null;
  currency?: string | null;
  contact_person?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  terms?: string | null;
  notes?: string | null;
  document_name?: string | null;
  has_document?: boolean;
};

type FormState = {
  company: CompanyTab;
  agreement_type: AgreementType;
  vendor_name: string;
  title: string;
  contract_ref: string;
  start_date: string;
  end_date: string;
  renewal_date: string;
  auto_renewing: boolean;
  status: AgreementStatus;
  value_amount: string;
  currency: string;
  contact_person: string;
  contact_phone: string;
  contact_email: string;
  terms: string;
  notes: string;
};

const PAGE_KEY = 'itams.org.agreements.pageSize';
const COMPANY_FILTERS: { id: CompanyTab; label: string }[] = [
  { id: 'ALL', label: 'All companies' },
  { id: 'IT', label: 'ITL' },
  { id: 'IMS', label: 'IMS' },
  { id: 'ISP', label: 'ISP' },
];
const TYPE_OPTIONS: { id: AgreementType | ''; label: string }[] = [
  { id: '', label: 'All types' },
  { id: 'software', label: 'Software' },
  { id: 'hardware', label: 'Hardware' },
  { id: 'networking', label: 'Networking' },
];
const STATUS_OPTIONS: { id: AgreementStatus | ''; label: string }[] = [
  { id: '', label: 'All statuses' },
  { id: 'active', label: 'Active' },
  { id: 'expiring', label: 'Expiring soon' },
  { id: 'expired', label: 'Expired' },
  { id: 'draft', label: 'Draft' },
  { id: 'cancelled', label: 'Cancelled' },
];
const FORM_TYPE_OPTIONS: { id: AgreementType; label: string }[] = [
  { id: 'software', label: 'Software License / SaaS' },
  { id: 'hardware', label: 'Hardware / Equipment' },
  { id: 'networking', label: 'Networking / Connectivity' },
];
const CURRENCY_OPTIONS = [
  { id: 'LKR', label: 'LKR (Rs.)' },
  { id: 'USD', label: 'USD ($)' },
  { id: 'EUR', label: 'EUR (€)' },
  { id: 'GBP', label: 'GBP (£)' },
];

function readStoredPageSize(): PageSize {
  try {
    const raw = Number(localStorage.getItem(PAGE_KEY));
    if (raw === 5 || raw === 10 || raw === 20 || raw === 50 || raw === 100 || raw === 500) return raw;
  } catch {
    /* ignore */
  }
  return 10;
}

function emptyForm(company: CompanyTab = 'ALL'): FormState {
  return {
    company,
    agreement_type: 'software',
    vendor_name: '',
    title: '',
    contract_ref: '',
    start_date: '',
    end_date: '',
    renewal_date: '',
    auto_renewing: true,
    status: 'active',
    value_amount: '',
    currency: 'LKR',
    contact_person: '',
    contact_phone: '',
    contact_email: '',
    terms: '',
    notes: '',
  };
}

function dash(v: unknown): string {
  if (v == null || String(v).trim() === '') return '—';
  return String(v);
}

function fmtDate(v?: string | null): string {
  if (!v) return '—';
  return String(v).slice(0, 10);
}

/** Suggest new end date = current end (or today) + 1 year */
function suggestRenewEnd(end?: string | null): string {
  const base = (end && String(end).slice(0, 10)) || new Date().toISOString().slice(0, 10);
  const d = new Date(`${base}T12:00:00`);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function suggestRenewalDecision(endDate: string): string {
  const d = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  switch (String(status).toLowerCase()) {
    case 'active':
      return 'success';
    case 'expiring':
      return 'warning';
    case 'expired':
    case 'cancelled':
      return 'danger';
    case 'draft':
      return 'info';
    default:
      return 'neutral';
  }
}

function statusLabel(status: string): string {
  switch (String(status).toLowerCase()) {
    case 'active':
      return 'Active';
    case 'expiring':
      return 'Expiring';
    case 'expired':
      return 'Expired';
    case 'cancelled':
      return 'Cancelled';
    case 'draft':
      return 'Draft';
    default:
      return String(status || '—');
  }
}

function typeLabel(t: string): string {
  switch (t) {
    case 'software':
      return 'Software License / SaaS';
    case 'hardware':
      return 'Hardware / Equipment';
    case 'networking':
      return 'Networking / Connectivity';
    default:
      return t || '—';
  }
}

function SectionHead({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="agr-section-head">
      <span className="agr-section-num" aria-hidden>
        {n}
      </span>
      <div className="agr-section-titles">
        <h4>{title}</h4>
        {hint ? <span className="agr-section-hint">{hint}</span> : null}
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`agr-field${className ? ` ${className}` : ''}`}>
      <span className="agr-label">
        {label}
        {required ? <em aria-hidden>*</em> : null}
        {hint ? <span className="agr-label-hint">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function IconInput({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="agr-icon-input">
      <span className="agr-icon" aria-hidden>
        {icon}
      </span>
      {children}
    </div>
  );
}

export default function AgreementsPanel() {
  const toast = useToast();
  const { user } = useAuth();
  const canManage = ['super_admin', 'it_admin', 'it_staff'].includes(user?.role ?? '');
  const termsRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [company, setCompany] = useState<CompanyTab>('ALL');
  const [typeFilter, setTypeFilter] = useState<AgreementType | ''>('');
  const [statusFilter, setStatusFilter] = useState<AgreementStatus | ''>('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(() => readStoredPageSize());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Agreement | null>(null);
  const [viewing, setViewing] = useState<Agreement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Agreement | null>(null);
  const [renewTarget, setRenewTarget] = useState<Agreement | null>(null);
  const [renewEnd, setRenewEnd] = useState('');
  const [renewDecision, setRenewDecision] = useState('');
  const [renewNote, setRenewNote] = useState('');
  const [renewing, setRenewing] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [docFile, setDocFile] = useState<File | null>(null);
  const [existingDocName, setExistingDocName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (company !== 'ALL') params.set('company', company);
      if (typeFilter) params.set('type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (q.trim()) params.set('q', q.trim());
      const res = await api<{ data: Agreement[] }>(`/api/agreements?${params.toString()}`);
      setRows(res.data ?? []);
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agreements');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, typeFilter, statusFilter]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    if (!formOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        const formEl = document.getElementById('agreement-form') as HTMLFormElement | null;
        formEl?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [formOpen]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const from = rows.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, rows.length);
  const filtersActive = Boolean(q.trim() || typeFilter || statusFilter || company !== 'ALL');

  function changePageSize(size: PageSize) {
    setPageSize(size);
    setPage(1);
    try {
      localStorage.setItem(PAGE_KEY, String(size));
    } catch {
      /* ignore */
    }
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyForm(company === 'ALL' ? 'ALL' : company));
    setDocFile(null);
    setExistingDocName(null);
    setFormOpen(true);
  }

  function openEdit(a: Agreement) {
    setEditing(a);
    const co = (a.company_code === 'IMS' || a.company_code === 'ISP' ? a.company_code : a.company_id ? 'IT' : 'ALL') as CompanyTab;
    setForm({
      company: a.company_id == null ? 'ALL' : co,
      agreement_type: a.agreement_type,
      vendor_name: a.vendor_name ?? '',
      title: a.title ?? '',
      contract_ref: a.contract_ref ?? '',
      start_date: String(a.start_date ?? '').slice(0, 10),
      end_date: String(a.end_date ?? '').slice(0, 10),
      renewal_date: String(a.renewal_date ?? '').slice(0, 10),
      auto_renewing: Boolean(a.auto_renewing),
      status: (['active', 'expiring', 'expired', 'cancelled', 'draft'].includes(String(a.status))
        ? a.status
        : 'active') as AgreementStatus,
      value_amount: a.value_amount != null && a.value_amount !== '' ? String(a.value_amount) : '',
      currency: a.currency || 'LKR',
      contact_person: a.contact_person ?? '',
      contact_phone: a.contact_phone ?? '',
      contact_email: a.contact_email ?? '',
      terms: a.terms ?? '',
      notes: a.notes ?? '',
    });
    setDocFile(null);
    setExistingDocName(a.has_document ? a.document_name || 'Signed contract' : null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setDocFile(null);
    setExistingDocName(null);
  }

  function wrapTerms(prefix: string, suffix = prefix) {
    const el = termsRef.current;
    if (!el) {
      setForm((f) => ({ ...f, terms: `${f.terms}${prefix}${suffix}` }));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const selected = el.value.slice(start, end) || 'text';
    const next = el.value.slice(0, start) + prefix + selected + suffix + el.value.slice(end);
    setForm((f) => ({ ...f, terms: next }));
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + prefix.length + selected.length + suffix.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  function onPickFile(file: File | null) {
    if (!file) {
      setDocFile(null);
      return;
    }
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!['pdf', 'doc', 'docx'].includes(ext)) {
      toast.error('Only PDF, DOC, or DOCX files are allowed');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error('File must be under 25MB');
      return;
    }
    setDocFile(file);
  }

  async function uploadDoc(agreementId: number) {
    if (!docFile) return;
    const body = new FormData();
    body.append('document', docFile);
    await api(`/api/agreements/${agreementId}/document`, { method: 'POST', body });
  }

  async function persist(statusOverride?: AgreementStatus) {
    if (!form.vendor_name.trim() || !form.title.trim()) {
      toast.error('Vendor and agreement title are required');
      return;
    }
    const status = statusOverride ?? form.status;
    if (status !== 'draft' && (!form.start_date || !form.end_date)) {
      toast.error('Start and end dates are required');
      return;
    }

    setSaving(true);
    try {
      const body = {
        company: form.company,
        agreement_type: form.agreement_type,
        vendor_name: form.vendor_name.trim(),
        title: form.title.trim(),
        contract_ref: form.contract_ref.trim() || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        renewal_date: form.renewal_date || null,
        auto_renewing: form.auto_renewing,
        status,
        value_amount: form.value_amount.trim() === '' ? null : Number(form.value_amount.replace(/,/g, '')),
        currency: form.currency.trim() || 'LKR',
        contact_person: form.contact_person.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        contact_email: form.contact_email.trim() || null,
        terms: form.terms.trim() || null,
        notes: form.notes.trim() || null,
      };
      let id = editing?.id;
      if (editing) {
        await api(`/api/agreements/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
        toast.success(status === 'draft' ? 'Draft saved' : 'Agreement updated');
      } else {
        const res = await api<{ data: Agreement }>('/api/agreements', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        id = res.data?.id;
        toast.success(status === 'draft' ? 'Draft saved' : 'Agreement added');
      }
      if (id && docFile) {
        await uploadDoc(id);
      }
      closeForm();
      setHistoryKey((k) => k + 1);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist(form.status === 'draft' ? 'active' : form.status);
  }

  function openRenew(a: Agreement) {
    const end = suggestRenewEnd(a.end_date);
    setRenewTarget(a);
    setRenewEnd(end);
    setRenewDecision(suggestRenewalDecision(end));
    setRenewNote('');
  }

  async function onRenew() {
    if (!renewTarget) return;
    if (!renewEnd) {
      toast.error('New end date is required');
      return;
    }
    setRenewing(true);
    try {
      const res = await api<{ data: Agreement }>(`/api/agreements/${renewTarget.id}/renew`, {
        method: 'POST',
        body: JSON.stringify({
          end_date: renewEnd,
          renewal_date: renewDecision || null,
          note: renewNote.trim() || null,
        }),
      });
      toast.success('Agreement renewed');
      const updated = res.data;
      setRenewTarget(null);
      if (updated) {
        setViewing(updated);
        setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      }
      setHistoryKey((k) => k + 1);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Renewal failed');
    } finally {
      setRenewing(false);
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/agreements/${deleteTarget.id}`, { method: 'DELETE' });
      toast.success('Agreement removed');
      if (viewing?.id === deleteTarget.id) setViewing(null);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="asset-filter-panel">
        <div className="asset-filter-grid" style={{ gridTemplateColumns: 'minmax(0,1.4fr) repeat(3, minmax(0,1fr))' }}>
          <label className="asset-filter-field">
            <span className="asset-filter-label">Search</span>
            <input
              className="asset-filter-control"
              placeholder="Vendor, title, contract no, terms…"
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
            <span className="asset-filter-label">Type</span>
            <select
              className="asset-filter-control"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value as AgreementType | '');
                setPage(1);
              }}
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t.id || 'all'} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="asset-filter-field">
            <span className="asset-filter-label">Status</span>
            <select
              className="asset-filter-control"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as AgreementStatus | '');
                setPage(1);
              }}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.id || 'all'} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="asset-filter-footer">
          <p className="asset-filter-count">
            {loading ? (
              'Loading…'
            ) : (
              <>
                Showing <strong>{rows.length === 0 ? '0' : `${from}–${to}`}</strong> of{' '}
                <strong>{rows.length}</strong> agreement{rows.length === 1 ? '' : 's'}
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
                setTypeFilter('');
                setStatusFilter('');
                setPage(1);
              }}
            >
              Clear filters
            </button>
            {canManage ? (
              <button type="button" className="btn btn-primary" onClick={openAdd}>
                + Add agreement
              </button>
            ) : null}
            <TableSettingsMenu
              pageSize={pageSize}
              onPageSizeChange={changePageSize}
              onRefresh={() => void load()}
              refreshing={loading}
              rangeLabel={rows.length === 0 ? '0 of 0' : `${from} - ${to} of ${rows.length}`}
            />
            <PaginationBar page={safePage} totalPages={totalPages} onPageChange={setPage} disabled={loading} />
          </div>
        </div>
      </div>

      {loading ? <LoadingSkeleton rows={6} /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && rows.length === 0 ? (
        <EmptyState
          title="No agreements yet"
          message="Add software, hardware, and networking agreements with vendors here."
          action={
            canManage ? (
              <button type="button" className="btn btn-primary" onClick={openAdd}>
                + Add agreement
              </button>
            ) : undefined
          }
        />
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <DataTableShell>
          <table className="table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Title</th>
                <th>Type</th>
                <th>Company</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.vendor_name}</strong>
                  </td>
                  <td>{a.title}</td>
                  <td>{a.type_label || typeLabel(a.agreement_type)}</td>
                  <td>{a.company_label || 'All companies'}</td>
                  <td>{fmtDate(a.start_date)}</td>
                  <td>{fmtDate(a.end_date)}</td>
                  <td>
                    <StatusBadge tone={statusTone(String(a.status))} label={statusLabel(String(a.status))} />
                  </td>
                  <td>
                    <ActionsMenu
                      onView={() => setViewing(a)}
                      onUpdate={() => {
                        if (canManage) openEdit(a);
                        else toast.error('Only IT staff can edit agreements');
                      }}
                      onDelete={() => {
                        if (canManage) setDeleteTarget(a);
                        else toast.error('Only IT staff can remove agreements');
                      }}
                      deleteDisabled={!canManage}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableShell>
      ) : null}

      <Modal
        open={formOpen}
        xwide
        className="agr-modal"
        title={editing ? 'Edit agreement' : 'Add new agreement'}
        eyebrow="Organization · Indra Group / Agreements"
        subtitle="Register vendor details, compliance milestones, SLA constraints, and financial terms."
        onClose={closeForm}
        footer={
          <div className="agr-footer">
            <p className="agr-shortcuts">
              <kbd>esc</kbd> to dismiss
              <span aria-hidden>·</span>
              <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to submit
            </p>
            <div className="agr-footer-actions">
              <button type="button" className="btn btn-soft" disabled={saving} onClick={closeForm}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-ghost agr-draft-btn"
                disabled={saving}
                onClick={() => void persist('draft')}
              >
                Save as draft
              </button>
              <button type="submit" form="agreement-form" className="btn btn-primary agr-submit-btn" disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save changes' : '+ Add agreement'}
              </button>
            </div>
          </div>
        }
      >
        <form id="agreement-form" className="agr-form" onSubmit={(e) => void onSave(e)}>
          <section className="agr-section">
            <SectionHead n={1} title="Contract & entity overview" />
            <div className="agr-grid">
              <Field label="Vendor / Supplier Name" required className="span-2">
                <IconInput icon={<IconBuilding />}>
                  <input
                    className="input"
                    required
                    value={form.vendor_name}
                    onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))}
                    placeholder="e.g. Microsoft Corporation, Dialog Axiata, Cisco Systems"
                  />
                </IconInput>
              </Field>
              <Field label="Agreement Title" required className="span-2">
                <IconInput icon={<IconDoc />}>
                  <input
                    className="input"
                    required
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Microsoft 365 Enterprise E5 · Firewall AMC Support"
                  />
                </IconInput>
              </Field>
              <Field label="Agreement Type" required>
                <IconInput icon={<IconMonitor />}>
                  <select
                    className="input"
                    value={form.agreement_type}
                    onChange={(e) => setForm((f) => ({ ...f, agreement_type: e.target.value as AgreementType }))}
                  >
                    {FORM_TYPE_OPTIONS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </IconInput>
              </Field>
              <Field label="Internal Entity / Company" required>
                <IconInput icon={<IconBuilding />}>
                  <select
                    className="input"
                    value={form.company}
                    onChange={(e) => setForm((f) => ({ ...f, company: e.target.value as CompanyTab }))}
                  >
                    <option value="ALL">All Companies (Indra Group Holding)</option>
                    <option value="IT">ITL</option>
                    <option value="IMS">IMS</option>
                    <option value="ISP">ISP</option>
                  </select>
                </IconInput>
              </Field>
              <Field label="Contract / Reference No.">
                <IconInput icon={<IconHash />}>
                  <input
                    className="input"
                    value={form.contract_ref}
                    onChange={(e) => setForm((f) => ({ ...f, contract_ref: e.target.value }))}
                    placeholder="e.g. CON-2024-8849-MSA"
                  />
                </IconInput>
              </Field>
              <Field label="Contract Status">
                <IconInput icon={<IconStatusDot status={form.status} />}>
                  <select
                    className="input"
                    value={form.status === 'expiring' ? 'active' : form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as AgreementStatus }))}
                  >
                    <option value="active">Active</option>
                    <option value="draft">Draft</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="expired">Expired</option>
                  </select>
                </IconInput>
              </Field>
            </div>
          </section>

          <section className="agr-section">
            <SectionHead n={2} title="Timeline & renewal schedule" hint="Automatic expiry alerts configured (30d)" />
            <div className="agr-grid">
              <Field label="Start Date" required>
                <IconInput icon={<IconCalendar />}>
                  <input
                    className="input"
                    type="date"
                    min={DATE_MIN}
                    required={form.status !== 'draft'}
                    value={form.start_date}
                    onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  />
                </IconInput>
              </Field>
              <Field label="End / Expiration Date" required>
                <IconInput icon={<IconCalendar />}>
                  <input
                    className="input"
                    type="date"
                    required={form.status !== 'draft'}
                    min={form.start_date || DATE_MIN}
                    value={form.end_date}
                    onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </IconInput>
              </Field>
              <Field label="Renewal Decision Date" hint="Notice Cut-off" className="span-2">
                <IconInput icon={<IconCalendar />}>
                  <input
                    className="input"
                    type="date"
                    min={DATE_MIN}
                    value={form.renewal_date}
                    onChange={(e) => setForm((f) => ({ ...f, renewal_date: e.target.value }))}
                  />
                </IconInput>
              </Field>
              <div className="agr-toggle-row span-2">
                <span className="agr-toggle-icon" aria-hidden>
                  <IconRefresh />
                </span>
                <div className="agr-toggle-copy">
                  <strong>Auto-Renewing Contract</strong>
                  <p>Enable automated workflow reminder 30 days prior to notice cut-off date.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.auto_renewing}
                  className={`agr-switch${form.auto_renewing ? ' on' : ''}`}
                  onClick={() => setForm((f) => ({ ...f, auto_renewing: !f.auto_renewing }))}
                >
                  <span className="agr-switch-knob" />
                </button>
              </div>
            </div>
          </section>

          <section className="agr-section">
            <SectionHead n={3} title="Financial value & key contact" />
            <div className="agr-grid">
              <Field label="Contract Total Value" className="span-2">
                <div className="agr-money">
                  <select
                    className="input agr-currency"
                    value={form.currency}
                    onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                    aria-label="Currency"
                  >
                    {CURRENCY_OPTIONS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={form.value_amount}
                    onChange={(e) => setForm((f) => ({ ...f, value_amount: e.target.value }))}
                    placeholder="e.g. 1,458,000.00"
                  />
                </div>
                <span className="agr-help">Leave empty if agreement has variable or consumption-based billing.</span>
              </Field>
              <Field label="Vendor Account Executive / POC" className="span-2">
                <IconInput icon={<IconUser />}>
                  <input
                    className="input"
                    value={form.contact_person}
                    onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))}
                    placeholder="e.g. Sarah Jenkins (Client Director)"
                  />
                </IconInput>
              </Field>
              <Field label="Contact Phone Number">
                <IconInput icon={<IconPhone />}>
                  <input
                    className="input"
                    value={form.contact_phone}
                    onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
                    placeholder="+94 77 123 4567 or direct line"
                  />
                </IconInput>
              </Field>
              <Field label="Contact Email Address">
                <IconInput icon={<IconAt />}>
                  <input
                    className="input"
                    type="email"
                    value={form.contact_email}
                    onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
                    placeholder="sarah.j@vendor-domain.com"
                  />
                </IconInput>
              </Field>
            </div>
          </section>

          <section className="agr-section">
            <SectionHead n={4} title="Terms, SLA & internal notes" />
            <div className="agr-grid">
              <div className="agr-field span-2">
                <div className="agr-label-row">
                  <span className="agr-label">Key Terms, SLA Clauses & Penalty Specifications</span>
                  <span className="agr-md-tag">Markdown supported</span>
                </div>
                <div className="agr-md-box">
                  <div className="agr-md-toolbar">
                    <button type="button" title="Bold" onClick={() => wrapTerms('**')}>
                      <strong>B</strong>
                    </button>
                    <button type="button" title="Italic" onClick={() => wrapTerms('_')}>
                      <em>I</em>
                    </button>
                    <button type="button" title="Bulleted list" onClick={() => wrapTerms('\n- ', '')}>
                      ≡
                    </button>
                  </div>
                  <textarea
                    ref={termsRef}
                    className="input agr-md-area"
                    rows={5}
                    value={form.terms}
                    onChange={(e) => setForm((f) => ({ ...f, terms: e.target.value }))}
                    placeholder="Specify key commitments: License count (e.g. 500 seats), SLA response limits, warranty coverage, termination penalties, liabilities…"
                  />
                </div>
              </div>
              <Field label="Internal Remarks & Audit Notes" className="span-2">
                <textarea
                  className="input"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Confidential procurement notes, cost center codes, executive approval references…"
                />
              </Field>
              <div className="agr-field span-2">
                <span className="agr-label">Signed Contract Document (PDF, DOCX)</span>
                <button
                  type="button"
                  className={`agr-dropzone${docFile || existingDocName ? ' has-file' : ''}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    onPickFile(e.dataTransfer.files?.[0] ?? null);
                  }}
                >
                  <IconCloud />
                  <div>
                    <strong>
                      {docFile
                        ? docFile.name
                        : existingDocName
                          ? existingDocName
                          : 'Upload executed PDF agreement'}
                    </strong>
                    <p>
                      {docFile
                        ? `${(docFile.size / (1024 * 1024)).toFixed(1)} MB · click to replace`
                        : existingDocName
                          ? 'Click to replace existing document'
                          : 'Up to 25MB encrypted storage'}
                    </p>
                  </div>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  hidden
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>
          </section>
        </form>
      </Modal>

      <Modal
        open={viewing != null}
        wide
        title={viewing?.title || 'Agreement'}
        eyebrow={viewing?.vendor_name || 'Agreement'}
        onClose={() => setViewing(null)}
        footer={
          <>
            <button type="button" className="btn btn-soft" onClick={() => setViewing(null)}>
              Close
            </button>
            {viewing?.has_document ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  void downloadAuthenticated(
                    `/api/agreements/${viewing.id}/document`,
                    viewing.document_name || 'agreement.pdf',
                  ).catch((err) => toast.error(err instanceof Error ? err.message : 'Download failed'))
                }
              >
                Download contract
              </button>
            ) : null}
            {canManage && viewing ? (
              <button type="button" className="btn btn-ghost" onClick={() => openRenew(viewing)}>
                Renew
              </button>
            ) : null}
            {canManage && viewing ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const a = viewing;
                  setViewing(null);
                  openEdit(a);
                }}
              >
                Edit
              </button>
            ) : null}
          </>
        }
      >
        {viewing ? (
          <div className="agr-view-stack">
            <div className="org-view-grid">
              <div>
                <span className="muted">Vendor</span>
                <strong>{viewing.vendor_name}</strong>
              </div>
              <div>
                <span className="muted">Type</span>
                <strong>{viewing.type_label || typeLabel(viewing.agreement_type)}</strong>
              </div>
              <div>
                <span className="muted">Company</span>
                <strong>{viewing.company_label || 'All companies'}</strong>
              </div>
              <div>
                <span className="muted">Status</span>
                <StatusBadge tone={statusTone(String(viewing.status))} label={statusLabel(String(viewing.status))} />
              </div>
              <div>
                <span className="muted">Contract no.</span>
                <strong>{dash(viewing.contract_ref)}</strong>
              </div>
              <div>
                <span className="muted">Value</span>
                <strong>
                  {viewing.value_amount != null && viewing.value_amount !== ''
                    ? `${viewing.currency || 'LKR'} ${viewing.value_amount}`
                    : '—'}
                </strong>
              </div>
              <div>
                <span className="muted">Start</span>
                <strong>{fmtDate(viewing.start_date)}</strong>
              </div>
              <div>
                <span className="muted">End</span>
                <strong>{fmtDate(viewing.end_date)}</strong>
              </div>
              <div>
                <span className="muted">Renewal decision</span>
                <strong>{fmtDate(viewing.renewal_date)}</strong>
              </div>
              <div>
                <span className="muted">Auto-renewing</span>
                <strong>{viewing.auto_renewing ? 'Yes' : 'No'}</strong>
              </div>
              <div>
                <span className="muted">Contact</span>
                <strong>{dash(viewing.contact_person)}</strong>
              </div>
              <div>
                <span className="muted">Phone</span>
                <strong>{dash(viewing.contact_phone)}</strong>
              </div>
              <div className="span-2">
                <span className="muted">Email</span>
                <strong>{dash(viewing.contact_email)}</strong>
              </div>
              <div className="span-2">
                <span className="muted">Terms / SLA</span>
                <p className="org-terms-block">{viewing.terms?.trim() ? viewing.terms : '—'}</p>
              </div>
              <div className="span-2">
                <span className="muted">Internal notes</span>
                <p className="org-terms-block">{viewing.notes?.trim() ? viewing.notes : '—'}</p>
              </div>
              {viewing.has_document ? (
                <div className="span-2">
                  <span className="muted">Signed document</span>
                  <strong>{viewing.document_name || 'Attached'}</strong>
                </div>
              ) : null}
            </div>
            <AgreementHistoryTimeline agreementId={viewing.id} refreshKey={historyKey} />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={renewTarget != null}
        title="Renew agreement"
        eyebrow={renewTarget?.vendor_name || 'Agreement'}
        subtitle="Extend the contract term. This is logged in the agreement history."
        onClose={() => (!renewing ? setRenewTarget(null) : undefined)}
        footer={
          <>
            <button type="button" className="btn btn-soft" disabled={renewing} onClick={() => setRenewTarget(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={renewing} onClick={() => void onRenew()}>
              {renewing ? 'Renewing…' : 'Confirm renewal'}
            </button>
          </>
        }
      >
        {renewTarget ? (
          <div className="agr-renew-form">
            <p className="agr-renew-current">
              Current end: <strong>{fmtDate(renewTarget.end_date)}</strong>
              <span aria-hidden> · </span>
              Decision date: <strong>{fmtDate(renewTarget.renewal_date)}</strong>
            </p>
            <label className="agr-field">
              <span>New end date</span>
              <input
                type="date"
                min={DATE_MIN}
                value={renewEnd}
                onChange={(e) => {
                  const v = e.target.value;
                  setRenewEnd(v);
                  if (v) setRenewDecision(suggestRenewalDecision(v));
                }}
              />
            </label>
            <label className="agr-field">
              <span>New renewal decision date</span>
              <input type="date" min={DATE_MIN} value={renewDecision} onChange={(e) => setRenewDecision(e.target.value)} />
            </label>
            <label className="agr-field">
              <span>Note (optional)</span>
              <textarea
                rows={3}
                value={renewNote}
                placeholder="e.g. Renewed under same terms for another year"
                onChange={(e) => setRenewNote(e.target.value)}
              />
            </label>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleteTarget != null}
        title="Remove agreement"
        message={`Remove “${deleteTarget?.title || 'this agreement'}” with ${deleteTarget?.vendor_name || 'vendor'}?`}
        confirmLabel="Remove"
        busy={deleting}
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void onDelete()}
      />

      <style>{`
        .agr-modal .modal-header p:first-child { color: var(--primary) !important; }
        .agr-form { display: flex; flex-direction: column; gap: 1.35rem; }
        .agr-section { display: flex; flex-direction: column; gap: 0.85rem; }
        .agr-section-head {
          display: flex;
          align-items: center;
          gap: 0.65rem;
        }
        .agr-section-num {
          width: 1.55rem;
          height: 1.55rem;
          border-radius: 0.4rem;
          background: var(--primary);
          color: #fff;
          font-size: 0.78rem;
          font-weight: 800;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .agr-section-titles { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.45rem 0.75rem; }
        .agr-section-titles h4 {
          margin: 0;
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #0f172a;
        }
        .agr-section-hint {
          font-size: 0.72rem;
          font-weight: 600;
          color: #94a3b8;
        }
        .agr-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.85rem 1rem;
        }
        .agr-grid .span-2 { grid-column: 1 / -1; }
        .agr-field {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          margin: 0;
        }
        .agr-label, .agr-label-row {
          display: flex;
          align-items: baseline;
          gap: 0.35rem;
          font-size: 0.78rem;
          font-weight: 700;
          color: #475569;
        }
        .agr-label-row { justify-content: space-between; }
        .agr-label em {
          color: #ef4444;
          font-style: normal;
          font-weight: 800;
        }
        .agr-label-hint {
          margin-left: auto;
          font-size: 0.7rem;
          font-weight: 600;
          color: #94a3b8;
        }
        .agr-md-tag {
          font-size: 0.68rem;
          font-weight: 700;
          color: var(--primary);
          letter-spacing: 0.02em;
        }
        .agr-icon-input {
          position: relative;
          display: block;
        }
        .agr-icon-input .agr-icon {
          position: absolute;
          left: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
          display: inline-flex;
          pointer-events: none;
        }
        .agr-icon-input .input {
          padding-left: 2.35rem;
          width: 100%;
        }
        .agr-money {
          display: grid;
          grid-template-columns: 8.5rem 1fr;
          gap: 0;
        }
        .agr-money .agr-currency {
          border-top-right-radius: 0;
          border-bottom-right-radius: 0;
          border-right: 0;
          font-weight: 700;
          color: #334155;
          background: #f8fafc;
        }
        .agr-money .input:last-child {
          border-top-left-radius: 0;
          border-bottom-left-radius: 0;
        }
        .agr-help {
          font-size: 0.72rem;
          font-weight: 500;
          color: #94a3b8;
        }
        .agr-toggle-row {
          display: flex;
          align-items: center;
          gap: 0.85rem;
          padding: 0.85rem 1rem;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          background: #fafafa;
        }
        .agr-toggle-icon {
          width: 2.25rem;
          height: 2.25rem;
          border-radius: 999px;
          background: var(--primary-soft);
          color: var(--primary);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .agr-toggle-copy { flex: 1; min-width: 0; }
        .agr-toggle-copy strong {
          display: block;
          font-size: 0.9rem;
          color: #0f172a;
        }
        .agr-toggle-copy p {
          margin: 0.15rem 0 0;
          font-size: 0.78rem;
          color: #64748b;
          line-height: 1.4;
        }
        .agr-switch {
          width: 2.7rem;
          height: 1.55rem;
          border-radius: 999px;
          border: 0;
          padding: 0.15rem;
          background: #cbd5e1;
          cursor: pointer;
          flex-shrink: 0;
          transition: background 0.15s ease;
        }
        .agr-switch.on { background: var(--primary); }
        .agr-switch-knob {
          display: block;
          width: 1.25rem;
          height: 1.25rem;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
          transition: transform 0.15s ease;
        }
        .agr-switch.on .agr-switch-knob { transform: translateX(1.15rem); }
        .agr-md-box {
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          overflow: hidden;
          background: #fff;
        }
        .agr-md-toolbar {
          display: flex;
          gap: 0.15rem;
          padding: 0.35rem 0.45rem;
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
        }
        .agr-md-toolbar button {
          width: 1.85rem;
          height: 1.7rem;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: #475569;
          cursor: pointer;
          font-size: 0.85rem;
        }
        .agr-md-toolbar button:hover { background: #e2e8f0; }
        .agr-md-area {
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          resize: vertical;
          min-height: 7rem;
          line-height: 1.5;
        }
        .agr-dropzone {
          display: flex;
          align-items: center;
          gap: 0.85rem;
          width: 100%;
          text-align: left;
          padding: 1.1rem 1.15rem;
          border: 1.5px dashed #93c5fd;
          border-radius: 12px;
          background: var(--primary-muted);
          color: var(--primary);
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .agr-dropzone:hover { border-color: var(--primary); background: var(--primary-soft); }
        .agr-dropzone.has-file {
          border-style: solid;
          border-color: #60a5fa;
          background: #fff;
        }
        .agr-dropzone strong {
          display: block;
          font-size: 0.9rem;
          color: var(--primary);
        }
        .agr-dropzone p {
          margin: 0.15rem 0 0;
          font-size: 0.75rem;
          font-weight: 500;
          color: #64748b;
        }
        .agr-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          width: 100%;
          flex-wrap: wrap;
        }
        .agr-shortcuts {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.75rem;
          color: #94a3b8;
        }
        .agr-shortcuts kbd {
          display: inline-flex;
          align-items: center;
          padding: 0.1rem 0.35rem;
          border: 1px solid #e2e8f0;
          border-radius: 5px;
          background: #f8fafc;
          font-size: 0.68rem;
          font-family: inherit;
          color: #64748b;
        }
        .agr-footer-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-left: auto; }
        .agr-draft-btn {
          background: #f1f5f9 !important;
          color: #334155 !important;
          border-color: transparent !important;
        }
        .agr-submit-btn {
          background: var(--primary) !important;
          border-color: var(--primary) !important;
        }
        .agr-submit-btn:hover { filter: brightness(0.95); }
        .agr-modal .modal-footer { padding-top: 0.35rem; }
        .agr-view-stack { display: flex; flex-direction: column; gap: 1.15rem; }
        .agr-renew-form { display: flex; flex-direction: column; gap: 0.9rem; }
        .agr-renew-current {
          margin: 0;
          padding: 0.7rem 0.85rem;
          border-radius: 8px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          font-size: 0.88rem;
          color: #64748b;
        }
        .agr-renew-current strong { color: #0f172a; }
        .agr-renew-form .agr-field {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .agr-renew-form .agr-field > span {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #64748b;
        }
        .agr-renew-form input,
        .agr-renew-form textarea {
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 0.55rem 0.7rem;
          font: inherit;
          background: #fff;
        }
        .org-view-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.85rem 1.25rem;
        }
        .org-view-grid .span-2 { grid-column: 1 / -1; }
        .org-view-grid .muted {
          display: block;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #94a3b8;
          margin-bottom: 0.2rem;
        }
        .org-view-grid strong { font-size: 0.92rem; color: #0f172a; }
        .org-terms-block {
          margin: 0.15rem 0 0;
          white-space: pre-wrap;
          line-height: 1.5;
          color: #1e293b;
          font-size: 0.9rem;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 0.65rem 0.8rem;
        }
        @media (max-width: 720px) {
          .agr-grid, .org-view-grid { grid-template-columns: 1fr; }
          .agr-grid .span-2, .org-view-grid .span-2 { grid-column: auto; }
          .agr-money { grid-template-columns: 1fr; }
          .agr-money .agr-currency {
            border-radius: var(--radius);
            border-right: 1px solid var(--border);
          }
          .agr-money .input:last-child { border-radius: var(--radius); }
          .agr-footer { flex-direction: column; align-items: stretch; }
          .agr-footer-actions { margin-left: 0; }
        }
      `}</style>
    </>
  );
}

function IconBuilding() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01M9 18h.01M15 18h.01" />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function IconMonitor() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function IconHash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function IconAt() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function IconCloud() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M16 16h1a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.7 1.5A4 4 0 0 0 7 16h1" />
      <path d="M12 12v9M9 16l3-3 3 3" />
    </svg>
  );
}

function IconStatusDot({ status }: { status: string }) {
  const color =
    status === 'active' || status === 'expiring'
      ? '#22c55e'
      : status === 'draft'
        ? '#3b82f6'
        : status === 'cancelled' || status === 'expired'
          ? '#ef4444'
          : '#94a3b8';
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="4" fill={color} />
    </svg>
  );
}
