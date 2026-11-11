import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../components/ui/Modal';
import { api } from '../services/client';
import { useToast } from '../components/ui/Toast';
import { DATE_INPUT_MIN as DATE_MIN } from '../lib/dateInput';

type Asset = Record<string, unknown>;

const WINDOWS_VERSION_OPTIONS = [
  'Windows 11',
  'Windows 10',
  'Windows 8.1',
  'Windows 8',
  'Windows 7',
] as const;

const WARRANTY_PERIOD_OPTIONS = [
  '3 months',
  '6 months',
  '1 year',
  '2 years',
  'Expired',
] as const;

type FormState = {
  serial_number: string;
  brand: string;
  model: string;
  processor: string;
  ram: string;
  ssd: string;
  hdd: string;
  windows_version: string;
  invoice_no: string;
  amount: string;
  date: string;
  warranty_period: string;
  warranty: string;
  replace_reason: string;
  notes: string;
};

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function formatGb(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return String(v);
  return Number.isInteger(n) ? String(n) : String(n);
}

function fromAsset(asset: Asset): FormState {
  return {
    serial_number: str(asset.serial_number),
    brand: str(asset.brand),
    model: str(asset.model),
    processor: str(asset.cpu ?? asset.processor),
    ram: formatGb(asset.ram_gb ?? asset.ram),
    ssd: formatGb(asset.ssd_gb ?? asset.ssd),
    hdd: formatGb(asset.hdd_gb ?? asset.hdd),
    windows_version: str(asset.windows_version),
    invoice_no: str(asset.invoice_no),
    amount:
      asset.purchase_amount_lkr != null && String(asset.purchase_amount_lkr) !== ''
        ? String(asset.purchase_amount_lkr)
        : '',
    date: str(asset.purchase_date).slice(0, 10),
    warranty_period: str(asset.warranty_period),
    warranty: str(asset.warranty_expires_on).slice(0, 10),
    replace_reason: '',
    notes: '',
  };
}

function summaryLine(f: FormState): string {
  const parts: string[] = [];
  const bm = [f.brand, f.model].map((s) => s.trim()).filter(Boolean).join(' ');
  if (bm) parts.push(bm);
  if (f.serial_number.trim()) parts.push(`SN ${f.serial_number.trim()}`);
  if (f.processor.trim()) parts.push(f.processor.trim());
  if (f.ram.trim()) parts.push(`${f.ram.trim()}GB RAM`);
  if (f.ssd.trim()) parts.push(`SSD ${f.ssd.trim()}GB`);
  if (f.hdd.trim()) parts.push(`HDD ${f.hdd.trim()}GB`);
  if (f.windows_version.trim()) parts.push(f.windows_version.trim());
  return parts.length ? parts.join(' · ') : '—';
}

type Props = {
  open: boolean;
  asset: Asset | null;
  onClose: () => void;
  onReplaced: (updated: Asset) => void;
};

export default function PcReplaceHardwareModal({ open, asset, onClose, onReplaced }: Props) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() =>
    asset ? fromAsset(asset) : fromAsset({} as Asset),
  );
  const [oldSummary, setOldSummary] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !asset) return;
    const next = fromAsset(asset);
    setForm(next);
    setOldSummary(summaryLine(next));
  }, [open, asset]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const pcId = Number(asset?.id);
    if (!Number.isFinite(pcId) || pcId < 1) return;
    const reason = form.replace_reason.trim();
    if (!reason) {
      toast.error('Replace reason is required');
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ data?: Asset; message?: string }>(
        `/api/assets/pc/${pcId}/replace-hardware`,
        {
          method: 'POST',
          body: JSON.stringify({
            serial_number: form.serial_number.trim() || null,
            brand: form.brand.trim() || null,
            model: form.model.trim() || null,
            cpu: form.processor.trim() || null,
            processor: form.processor.trim() || null,
            ram_gb: form.ram.trim() || null,
            ssd_gb: form.ssd.trim() || null,
            hdd_gb: form.hdd.trim() || null,
            windows_version: form.windows_version.trim() || null,
            invoice_no: form.invoice_no.trim() || null,
            purchase_amount_lkr: form.amount.trim() || null,
            purchase_date: form.date.trim() || null,
            warranty_period: form.warranty_period.trim() || null,
            warranty_expires_on: form.warranty.trim() || null,
            replace_reason: reason,
            notes: form.notes.trim() || null,
          }),
        },
      );
      toast.success(res.message || 'PC hardware replaced');
      if (res.data) onReplaced(res.data);
      else onReplaced(asset);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Replace failed');
    } finally {
      setSaving(false);
    }
  }

  const tag = str(asset?.asset_tag);

  return (
    <Modal
      open={open}
      wide
      eyebrow="PC inventory"
      title="Replace PC hardware"
      subtitle={
        tag
          ? `Keep asset tag ${tag} and assignment history. Enter the new machine specs — old specs are saved on Lifecycle.`
          : 'Keep the same asset tag and assignment history. Old specs are saved on Lifecycle.'
      }
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <>
          <button type="button" className="btn btn-soft" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="pc-replace-hw-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Replacing…' : 'Confirm replace'}
          </button>
        </>
      }
    >
      <form id="pc-replace-hw-form" className="pc-replace-form" onSubmit={(e) => void onSubmit(e)}>
        <div className="pc-replace-old">
          <span className="pc-replace-label">Current machine (will be archived)</span>
          <p>{oldSummary || '—'}</p>
        </div>

        <label>
          <span>Brand</span>
          <input
            className="input"
            value={form.brand}
            onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
            placeholder="New brand"
            disabled={saving}
          />
        </label>
        <label>
          <span>Model</span>
          <input
            className="input"
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            placeholder="New model"
            disabled={saving}
          />
        </label>
        <label>
          <span>Serial number</span>
          <input
            className="input"
            value={form.serial_number}
            onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value }))}
            placeholder="New S/N"
            disabled={saving}
          />
        </label>
        <label>
          <span>Processor</span>
          <input
            className="input"
            value={form.processor}
            onChange={(e) => setForm((f) => ({ ...f, processor: e.target.value }))}
            disabled={saving}
          />
        </label>
        <label>
          <span>RAM (GB)</span>
          <input
            className="input"
            inputMode="decimal"
            value={form.ram}
            onChange={(e) => setForm((f) => ({ ...f, ram: e.target.value }))}
            disabled={saving}
          />
        </label>
        <label>
          <span>SSD (GB)</span>
          <input
            className="input"
            inputMode="decimal"
            value={form.ssd}
            onChange={(e) => setForm((f) => ({ ...f, ssd: e.target.value }))}
            disabled={saving}
          />
        </label>
        <label>
          <span>HDD (GB)</span>
          <input
            className="input"
            inputMode="decimal"
            value={form.hdd}
            onChange={(e) => setForm((f) => ({ ...f, hdd: e.target.value }))}
            disabled={saving}
          />
        </label>
        <label>
          <span>Windows version</span>
          <select
            className="input"
            value={form.windows_version}
            onChange={(e) => setForm((f) => ({ ...f, windows_version: e.target.value }))}
            disabled={saving}
          >
            <option value="">Select…</option>
            {WINDOWS_VERSION_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
            {form.windows_version &&
            !(WINDOWS_VERSION_OPTIONS as readonly string[]).includes(form.windows_version) ? (
              <option value={form.windows_version}>{form.windows_version}</option>
            ) : null}
          </select>
        </label>
        <label>
          <span>Invoice no.</span>
          <input
            className="input"
            value={form.invoice_no}
            onChange={(e) => setForm((f) => ({ ...f, invoice_no: e.target.value }))}
            disabled={saving}
          />
        </label>
        <label>
          <span>Purchase date</span>
          <input
            className="input"
            type="date"
            min={DATE_MIN}
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            disabled={saving}
          />
        </label>
        <label>
          <span>Amount (LKR)</span>
          <input
            className="input"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            disabled={saving}
          />
        </label>
        <label>
          <span>Warranty period</span>
          <select
            className="input"
            value={form.warranty_period}
            onChange={(e) => setForm((f) => ({ ...f, warranty_period: e.target.value }))}
            disabled={saving}
          >
            <option value="">Select…</option>
            {WARRANTY_PERIOD_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Warranty expires</span>
          <input
            className="input"
            type="date"
            min={DATE_MIN}
            value={form.warranty}
            onChange={(e) => setForm((f) => ({ ...f, warranty: e.target.value }))}
            disabled={saving}
          />
        </label>
        <label className="span-2">
          <span>Replace reason *</span>
          <input
            className="input"
            required
            value={form.replace_reason}
            onChange={(e) => setForm((f) => ({ ...f, replace_reason: e.target.value }))}
            placeholder="e.g. Motherboard failed — full unit swapped"
            disabled={saving}
          />
        </label>
        <label className="span-2">
          <span>Notes</span>
          <textarea
            className="input"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Optional — where old unit went, vendor, etc."
            disabled={saving}
          />
        </label>
      </form>

      <style>{`
        .pc-replace-form {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem 1rem;
        }
        .pc-replace-form label {
          display: flex;
          flex-direction: column;
          gap: 0.28rem;
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--muted);
        }
        .pc-replace-form label.span-2 { grid-column: 1 / -1; }
        .pc-replace-old {
          grid-column: 1 / -1;
          padding: 0.75rem 0.9rem;
          border-radius: 10px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }
        .pc-replace-label {
          display: block;
          font-size: 0.68rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #64748b;
          margin-bottom: 0.25rem;
        }
        .pc-replace-old p {
          margin: 0;
          font-size: 0.9rem;
          font-weight: 600;
          color: #0f172a;
          line-height: 1.4;
        }
        @media (max-width: 640px) {
          .pc-replace-form { grid-template-columns: 1fr; }
        }
      `}</style>
    </Modal>
  );
}
