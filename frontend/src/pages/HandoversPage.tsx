import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader';
import StatusBadge from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import { DataTableShell } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';
import AssetIcon from '../components/ui/AssetIcon';
import { api } from '../services/client';
import { DATE_INPUT_MIN as DATE_MIN } from '../lib/dateInput';

type Handover = Record<string, unknown>;

export default function HandoversPage() {
  const [rows, setRows] = useState<Handover[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    asset_type: 'laptop',
    asset_id: '',
    assigned_person_name: '',
    handover_date: new Date().toISOString().slice(0, 10),
    checkout_condition: 'good',
    checkout_remarks: '',
  });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await api<{ data: Handover[] }>('/api/handovers');
      setRows(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load handovers');
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
      ['assigned_person_name', 'asset_tag', 'pc_name', 'asset_type', 'gate_pass_no']
        .some((k) => String(r[k] ?? '').toLowerCase().includes(term)),
    );
  }, [rows, q]);

  async function onCheckout(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/api/handovers/checkout', {
        method: 'POST',
        body: JSON.stringify({
          asset_type: form.asset_type,
          asset_id: Number(form.asset_id),
          assigned_person_name: form.assigned_person_name,
          handover_date: form.handover_date,
          checkout_condition: form.checkout_condition,
          checkout_remarks: form.checkout_remarks || null,
        }),
      });
      setShowCheckout(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setSaving(false);
    }
  }

  async function onCheckin(id: number) {
    if (!window.confirm('Mark this handover as returned?')) return;
    const remarks = window.prompt('Return remarks (required):', '');
    if (remarks == null) return;
    if (!remarks.trim()) {
      setError('Return remarks are required');
      return;
    }
    try {
      await api(`/api/handovers/${id}/checkin`, {
        method: 'POST',
        body: JSON.stringify({
          return_date: new Date().toISOString().slice(0, 10),
          return_condition: 'good',
          return_remarks: remarks.trim(),
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Return failed');
    }
  }

  return (
    <main className="page page--fill">
      <PageHeader
        title="Asset Handovers"
        subtitle="Track checkout and return of IT assets"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setShowCheckout(true)}>
            + New Handover
          </button>
        }
      />

      <DataTableShell
        toolbar={
          <div className="toolbar">
            <input className="input" placeholder="Search handovers…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      >
        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : error && rows.length === 0 ? (
          <ErrorState description={error} onRetry={() => void load()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No handovers recorded"
            description="Create a handover when issuing a laptop or phone to an employee."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setShowCheckout(true)}>
                New Handover
              </button>
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Person</th>
                <th>Issued</th>
                <th>Returned</th>
                <th>Condition</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const open = r.is_open === true || r.is_open === 't' || r.is_open === 1;
                return (
                  <tr key={String(r.id)}>
                    <td>
                      <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center' }}>
                        <AssetIcon type={String(r.asset_type || 'laptop')} />
                        <div>
                          <strong>{String(r.asset_tag ?? r.asset_id ?? '—')}</strong>
                          <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                            {String(r.pc_name ?? r.asset_type ?? '')}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{String(r.assigned_person_name ?? '—')}</td>
                    <td>{String(r.handover_date ?? '—')}</td>
                    <td>{String(r.return_date ?? '—')}</td>
                    <td style={{ textTransform: 'capitalize' }}>{String(r.checkout_condition ?? '—')}</td>
                    <td>
                      <StatusBadge status={open ? 'assigned' : 'inactive'} label={open ? 'Open' : 'Returned'} />
                    </td>
                    <td>
                      {open ? (
                        <button type="button" className="btn btn-soft" onClick={() => void onCheckin(Number(r.id))}>
                          Mark returned
                        </button>
                      ) : (
                        <Link className="btn btn-soft" to={`/assets/${pathFor(String(r.asset_type))}`}>
                          View assets
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </DataTableShell>

      <Modal
        open={showCheckout}
        title="New asset handover"
        eyebrow="Checkout"
        onClose={() => setShowCheckout(false)}
        footer={
          <>
            <button type="button" className="btn btn-soft" disabled={saving} onClick={() => setShowCheckout(false)}>
              Cancel
            </button>
            <button type="submit" form="checkout-form" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Issue asset'}
            </button>
          </>
        }
      >
        <form id="checkout-form" className="form-grid" onSubmit={(e) => void onCheckout(e)}>
          <label>
            Asset type *
            <select className="select" value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })}>
              <option value="laptop">Laptop</option>
              <option value="mobile_phone">Mobile phone</option>
              <option value="pc">PC</option>
            </select>
          </label>
          <label>
            Asset ID *
            <input className="input" required value={form.asset_id} onChange={(e) => setForm({ ...form, asset_id: e.target.value })} placeholder="Numeric asset id" />
          </label>
          <label>
            Assigned to *
            <input className="input" required value={form.assigned_person_name} onChange={(e) => setForm({ ...form, assigned_person_name: e.target.value })} />
          </label>
          <label>
            Handover date *
            <input className="input" type="date" min={DATE_MIN} required value={form.handover_date} onChange={(e) => setForm({ ...form, handover_date: e.target.value })} />
          </label>
          <label>
            Condition
            <select className="select" value={form.checkout_condition} onChange={(e) => setForm({ ...form, checkout_condition: e.target.value })}>
              <option value="excellent">Excellent</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="damaged">Damaged</option>
            </select>
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Notes
            <textarea className="input" rows={3} value={form.checkout_remarks} onChange={(e) => setForm({ ...form, checkout_remarks: e.target.value })} />
          </label>
          {error ? <p className="error-text" style={{ gridColumn: '1 / -1' }}>{error}</p> : null}
        </form>
      </Modal>
    </main>
  );
}

function pathFor(assetType: string): string {
  if (assetType === 'mobile_phone') return 'mobile-phones';
  if (assetType === 'other' || assetType === 'printer') return 'others';
  return assetType || 'laptop';
}
