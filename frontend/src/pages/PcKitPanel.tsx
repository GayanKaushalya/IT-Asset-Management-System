import { FormEvent, useEffect, useState } from 'react';
import { Modal } from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
import { api } from '../services/client';
import { DATE_INPUT_MIN as DATE_MIN } from '../lib/dateInput';

export type KitKind =
  | 'ssd'
  | 'hdd'
  | 'mouse'
  | 'keyboard'
  | 'ups'
  | 'monitor'
  | 'power_cable'
  | 'vga_cable';

export type KitComponent = {
  id: number;
  component_kind: KitKind | string;
  kind_label?: string;
  is_current?: boolean;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  capacity_gb?: number | string | null;
  invoice_no?: string | null;
  purchase_date?: string | null;
  purchase_amount_lkr?: number | string | null;
  warranty_period?: string | null;
  warranty_expires_on?: string | null;
  notes?: string | null;
  replace_reason?: string | null;
  disposition?: string | null;
  replaced_at?: string | null;
  created_at?: string | null;
  created_by_name?: string | null;
  replaced_by_name?: string | null;
};

type FormState = {
  component_kind: KitKind;
  brand: string;
  model: string;
  serial_number: string;
  capacity_gb: string;
  invoice_no: string;
  purchase_date: string;
  purchase_amount_lkr: string;
  warranty_period: string;
  warranty_expires_on: string;
  notes: string;
  replace_reason: string;
};

const KIND_OPTIONS: { id: KitKind; label: string }[] = [
  { id: 'ssd', label: 'SSD' },
  { id: 'hdd', label: 'HDD' },
  { id: 'mouse', label: 'Mouse' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'ups', label: 'UPS' },
  { id: 'monitor', label: 'Monitor' },
  { id: 'power_cable', label: 'Power cable' },
  { id: 'vga_cable', label: 'VGA / display cable' },
];

function emptyForm(kind: KitKind = 'ssd'): FormState {
  return {
    component_kind: kind,
    brand: '',
    model: '',
    serial_number: '',
    capacity_gb: '',
    invoice_no: '',
    purchase_date: '',
    purchase_amount_lkr: '',
    warranty_period: '',
    warranty_expires_on: '',
    notes: '',
    replace_reason: '',
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

function kindLabel(k: string): string {
  return KIND_OPTIONS.find((o) => o.id === k)?.label ?? k;
}

type Props = {
  pcId: number;
  canManage: boolean;
  /** Bump after Asset details save so Kit reloads mirrored fields */
  refreshKey?: number;
  onChanged?: () => void;
};

export default function PcKitPanel({ pcId, canManage, refreshKey = 0, onChanged }: Props) {
  const toast = useToast();
  const [current, setCurrent] = useState<KitComponent[]>([]);
  const [history, setHistory] = useState<KitComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [replacing, setReplacing] = useState<KitComponent | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api<{ data: { current: KitComponent[]; history: KitComponent[] } }>(
        `/api/assets/pc/${pcId}/kit`,
      );
      setCurrent(res.data?.current ?? []);
      setHistory(res.data?.history ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load kit');
      setCurrent([]);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcId, refreshKey]);

  function openAssign(kind?: KitKind) {
    setReplacing(null);
    setForm(emptyForm(kind ?? 'ssd'));
    setFormOpen(true);
  }

  function openReplace(c: KitComponent) {
    setReplacing(c);
    setForm({
      ...emptyForm((c.component_kind as KitKind) || 'ssd'),
      component_kind: (c.component_kind as KitKind) || 'ssd',
      replace_reason: '',
    });
    setFormOpen(true);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (form.component_kind === 'ssd' || form.component_kind === 'hdd') {
      if (!form.capacity_gb.trim() || Number(form.capacity_gb) <= 0) {
        toast.error('Capacity (GB) is required for SSD/HDD');
        return;
      }
    }
    setSaving(true);
    try {
      await api(`/api/assets/pc/${pcId}/kit`, {
        method: 'POST',
        body: JSON.stringify({
          component_kind: form.component_kind,
          brand: form.brand.trim() || null,
          model: form.model.trim() || null,
          serial_number: form.serial_number.trim() || null,
          capacity_gb: form.capacity_gb.trim() === '' ? null : Number(form.capacity_gb),
          invoice_no: form.invoice_no.trim() || null,
          purchase_date: form.purchase_date || null,
          purchase_amount_lkr:
            form.purchase_amount_lkr.trim() === '' ? null : Number(form.purchase_amount_lkr.replace(/,/g, '')),
          warranty_period: form.warranty_period.trim() || null,
          warranty_expires_on: form.warranty_expires_on || null,
          notes: form.notes.trim() || null,
          replace_reason: form.replace_reason.trim() || (replacing ? 'Replaced' : null),
        }),
      });
      toast.success(replacing ? 'Component replaced' : 'Component assigned');
      setFormOpen(false);
      setReplacing(null);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onRetire(c: KitComponent, disposition: 'removed' | 'disposed') {
    const label = c.kind_label || kindLabel(String(c.component_kind));
    const ok =
      disposition === 'disposed'
        ? window.confirm(
            `Dispose ${label}? It will leave the PC kit and appear as disposed in Lifecycle.`,
          )
        : window.confirm(`Remove ${label} from this PC kit?`);
    if (!ok) return;
    const reason =
      disposition === 'disposed'
        ? window.prompt('Disposal note (optional)', 'Disposed / scrapped') || 'Disposed'
        : 'Removed from kit';
    try {
      await api(`/api/assets/pc/${pcId}/kit/${c.id}/retire`, {
        method: 'POST',
        body: JSON.stringify({ disposition, reason }),
      });
      toast.success(disposition === 'disposed' ? 'Component disposed' : 'Component removed');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  }

  const needsCapacity = form.component_kind === 'ssd' || form.component_kind === 'hdd';

  return (
    <div className="pc-kit-panel">
      <div className="pc-kit-head">
        <div>
          <h4>Current kit</h4>
          <p>Assign SSD, mouse, keyboard, UPS and other parts. Replacements stay in the change log below.</p>
        </div>
        {canManage ? (
          <button type="button" className="btn btn-primary" onClick={() => openAssign()}>
            + Assign component
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="muted">Loading kit…</p>
      ) : current.length === 0 ? (
        <div className="pc-kit-empty">
          <p className="muted">
            No kit components on this PC yet. Assign an SSD, mouse, monitor, or other part to track and dispose it
            here. Accessories already ticked on Asset details are imported automatically when you open this tab.
          </p>
          {canManage ? (
            <div className="pc-kit-quick">
              {KIND_OPTIONS.map((k) => (
                <button key={k.id} type="button" className="btn btn-soft btn-sm" onClick={() => openAssign(k.id)}>
                  + {k.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="pc-kit-cards">
          {current.map((c) => {
            const brandModel = [c.brand, c.model].filter(Boolean).join(' ');
            const hasCap = c.capacity_gb != null && String(c.capacity_gb).trim() !== '';
            const hasSerial = Boolean(c.serial_number?.toString().trim());
            const hasInvoice = Boolean(c.invoice_no?.toString().trim());
            const hasPurchase = Boolean(c.purchase_date?.toString().trim());
            const hasWarranty = Boolean(
              c.warranty_period?.toString().trim() || c.warranty_expires_on?.toString().trim(),
            );
            const summaryBits = [
              brandModel || null,
              hasCap ? `${c.capacity_gb} GB` : null,
              hasSerial ? `SN ${c.serial_number}` : null,
            ].filter(Boolean) as string[];

            return (
              <article key={c.id} className="pc-kit-card">
                <header>
                  <div className="pc-kit-card-title">
                    <strong>{c.kind_label || kindLabel(String(c.component_kind))}</strong>
                    {summaryBits.length > 0 ? (
                      <span className="pc-kit-card-summary">{summaryBits.join(' · ')}</span>
                    ) : (
                      <span className="pc-kit-card-summary muted">Standard kit part</span>
                    )}
                  </div>
                  {canManage ? (
                    <div className="pc-kit-card-actions">
                      <button type="button" className="btn btn-soft btn-sm" onClick={() => openReplace(c)}>
                        Replace
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => void onRetire(c, 'disposed')}
                      >
                        Dispose
                      </button>
                    </div>
                  ) : null}
                </header>
                {(hasInvoice || hasPurchase || hasWarranty) && (
                  <dl className="pc-kit-card-meta">
                    {hasInvoice ? (
                      <div>
                        <dt>Invoice</dt>
                        <dd>{c.invoice_no}</dd>
                      </div>
                    ) : null}
                    {hasPurchase ? (
                      <div>
                        <dt>Purchase</dt>
                        <dd>{fmtDate(c.purchase_date)}</dd>
                      </div>
                    ) : null}
                    {hasWarranty ? (
                      <div>
                        <dt>Warranty</dt>
                        <dd>
                          {c.warranty_period?.toString().trim() || '—'}
                          {c.warranty_expires_on ? ` · exp ${fmtDate(c.warranty_expires_on)}` : ''}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="pc-kit-history">
        <h4>Kit change log</h4>
        <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.82rem' }}>
          Full timeline (tagging, assignments, kit, disposal) is on the Lifecycle tab.
        </p>
        <div className="lifecycle-history-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Outcome</th>
                <th>Component</th>
                <th>Serial</th>
                <th>By</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No replacements or disposals yet.
                  </td>
                </tr>
              ) : (
                history.map((h) => {
                  const outcome = String((h as KitComponent & { disposition?: string }).disposition || 'replaced');
                  return (
                    <tr key={h.id}>
                      <td>
                        {h.replaced_at
                          ? new Date(h.replaced_at).toLocaleString('en-LK')
                          : h.created_at
                            ? new Date(h.created_at).toLocaleString('en-LK')
                            : '—'}
                      </td>
                      <td style={{ textTransform: 'capitalize' }}>{outcome}</td>
                      <td>
                        {h.kind_label || kindLabel(String(h.component_kind))}
                        {h.capacity_gb != null && h.capacity_gb !== '' ? ` (${h.capacity_gb} GB)` : ''}
                        {h.brand || h.model ? (
                          <span className="muted" style={{ display: 'block', fontSize: '0.78rem' }}>
                            {[h.brand, h.model].filter(Boolean).join(' ')}
                          </span>
                        ) : null}
                      </td>
                      <td>{dash(h.serial_number)}</td>
                      <td>{dash(h.replaced_by_name || h.created_by_name)}</td>
                      <td>{dash(h.replace_reason)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={formOpen}
        wide
        title={replacing ? `Replace ${replacing.kind_label || 'component'}` : 'Assign kit component'}
        eyebrow="PC kit"
        subtitle={
          replacing
            ? 'The current part moves to the change log. Enter the new part details below.'
            : 'Link a new SSD, mouse, keyboard, UPS, or cable to this PC.'
        }
        onClose={() => {
          setFormOpen(false);
          setReplacing(null);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn-soft"
              disabled={saving}
              onClick={() => {
                setFormOpen(false);
                setReplacing(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" form="pc-kit-form" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : replacing ? 'Replace' : 'Assign'}
            </button>
          </>
        }
      >
        <form id="pc-kit-form" className="pc-kit-form" onSubmit={(e) => void onSave(e)}>
          <label>
            <span>Component *</span>
            <select
              className="input"
              value={form.component_kind}
              disabled={!!replacing}
              onChange={(e) => setForm((f) => ({ ...f, component_kind: e.target.value as KitKind }))}
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Brand</span>
            <input
              className="input"
              value={form.brand}
              onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
              placeholder="e.g. Samsung, Logitech"
            />
          </label>
          <label>
            <span>Model</span>
            <input
              className="input"
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              placeholder="e.g. 980 PRO, M185"
            />
          </label>
          <label>
            <span>Serial number</span>
            <input
              className="input"
              value={form.serial_number}
              onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value }))}
            />
          </label>
          {needsCapacity ? (
            <label>
              <span>Capacity (GB) *</span>
              <input
                className="input"
                inputMode="decimal"
                required
                value={form.capacity_gb}
                onChange={(e) => setForm((f) => ({ ...f, capacity_gb: e.target.value }))}
                placeholder="e.g. 512"
              />
            </label>
          ) : null}
          <label>
            <span>Invoice no.</span>
            <input
              className="input"
              value={form.invoice_no}
              onChange={(e) => setForm((f) => ({ ...f, invoice_no: e.target.value }))}
            />
          </label>
          <label>
            <span>Purchase date</span>
            <input
              className="input"
              type="date"
              min={DATE_MIN}
              value={form.purchase_date}
              onChange={(e) => setForm((f) => ({ ...f, purchase_date: e.target.value }))}
            />
          </label>
          <label>
            <span>Amount (LKR)</span>
            <input
              className="input"
              inputMode="decimal"
              value={form.purchase_amount_lkr}
              onChange={(e) => setForm((f) => ({ ...f, purchase_amount_lkr: e.target.value }))}
            />
          </label>
          <label>
            <span>Warranty period</span>
            <input
              className="input"
              value={form.warranty_period}
              onChange={(e) => setForm((f) => ({ ...f, warranty_period: e.target.value }))}
              placeholder="e.g. 12 months"
            />
          </label>
          <label>
            <span>Warranty expires</span>
            <input
              className="input"
              type="date"
              min={DATE_MIN}
              value={form.warranty_expires_on}
              onChange={(e) => setForm((f) => ({ ...f, warranty_expires_on: e.target.value }))}
            />
          </label>
          {replacing ? (
            <label className="span-2">
              <span>Replace reason</span>
              <input
                className="input"
                value={form.replace_reason}
                onChange={(e) => setForm((f) => ({ ...f, replace_reason: e.target.value }))}
                placeholder="e.g. Failed SSD, upgraded to 1TB"
              />
            </label>
          ) : null}
          <label className="span-2">
            <span>Notes</span>
            <textarea
              className="input"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
        </form>
      </Modal>

      <style>{`
        .pc-kit-panel { display: flex; flex-direction: column; gap: 1.1rem; }
        .pc-kit-head {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 1rem; flex-wrap: wrap;
        }
        .pc-kit-head h4 { margin: 0 0 0.25rem; font-size: 0.95rem; }
        .pc-kit-head p { margin: 0; color: var(--muted); font-size: 0.85rem; max-width: 36rem; }
        .pc-kit-empty { display: flex; flex-direction: column; gap: 0.75rem; }
        .pc-kit-quick { display: flex; flex-wrap: wrap; gap: 0.4rem; }
        .pc-kit-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
          gap: 0.75rem;
        }
        .pc-kit-card {
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 0.75rem 0.85rem;
          background: #fff;
        }
        .pc-kit-card header {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 0.5rem;
        }
        .pc-kit-card-title { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
        .pc-kit-card-summary {
          font-size: 0.8rem; font-weight: 500; color: #64748b; line-height: 1.35;
        }
        .pc-kit-card-actions { display: flex; gap: 0.35rem; flex-shrink: 0; }
        .pc-kit-card-meta {
          margin: 0.55rem 0 0; display: grid;
          grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
          gap: 0.35rem 0.75rem;
        }
        .pc-kit-card-meta dt {
          margin: 0; font-size: 0.62rem; font-weight: 700;
          letter-spacing: 0.04em; text-transform: uppercase; color: #94a3b8;
        }
        .pc-kit-card-meta dd { margin: 0.05rem 0 0; font-size: 0.84rem; color: #0f172a; }
        .pc-kit-history h4 { margin: 0 0 0.5rem; font-size: 0.95rem; }
        .pc-kit-form {
          display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem 1rem;
        }
        .pc-kit-form label {
          display: flex; flex-direction: column; gap: 0.3rem;
          font-size: 0.78rem; font-weight: 600; color: #475569;
        }
        .pc-kit-form .span-2 { grid-column: 1 / -1; }
        .pc-kit-form textarea.input { resize: vertical; min-height: 3.5rem; }
        .muted { color: var(--muted); }
        .btn-sm { padding: 0.28rem 0.55rem; font-size: 0.78rem; }
        @media (max-width: 640px) {
          .pc-kit-form { grid-template-columns: 1fr; }
          .pc-kit-form .span-2 { grid-column: auto; }
        }
      `}</style>
    </div>
  );
}
