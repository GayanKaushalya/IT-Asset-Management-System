import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import AcceptanceFormPrint, {
  type AcceptanceFormData,
} from '../components/AcceptanceFormPrint';
import PageHeader, { LiveRepositoryBadge } from '../components/ui/PageHeader';
import StatusBadge from '../components/ui/StatusBadge';
import AssetIcon from '../components/ui/AssetIcon';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui/EmptyState';
import PaginationBar from '../components/ui/PaginationBar';
import TableSettingsMenu, { type PageSize } from '../components/ui/TableSettingsMenu';
import { useToast } from '../components/ui/Toast';
import { api } from '../services/client';
import { getOrgMeta } from '../services/metaCache';
import { printAcceptanceForm, dismissAcceptancePrintFrame } from '../utils/acceptancePrint';

const PAGE_SIZE_KEY = 'itams.reports.handover.pageSize';

function readStoredPageSize(): PageSize {
  try {
    const raw = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (raw === 5 || raw === 10 || raw === 20 || raw === 50 || raw === 100 || raw === 500) return raw;
  } catch {
    /* ignore */
  }
  return 10;
}

type DeviceRow = Record<string, unknown>;
type Company = { id: number; code: string; short_name: string; name: string };

const ASSET_TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'laptop', label: 'Laptop' },
  { value: 'mobile_phone', label: 'Mobile phone' },
  { value: 'other', label: 'Other asset' },
];

function dash(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v);
}

function typeLabel(t: unknown): string {
  const v = String(t ?? '');
  if (v === 'mobile_phone') return 'Mobile phone';
  if (v === 'laptop') return 'Laptop';
  if (v === 'pc') return 'PC';
  if (v === 'other') return 'Other asset';
  return (
    ASSET_TYPE_OPTIONS.find((o) => o.value === v)?.label ??
    v.replace(/_/g, ' ')
  );
}

function assetIdOf(r: DeviceRow): number {
  return Number(r.asset_id ?? 0);
}

function assetTypeOf(r: DeviceRow): string {
  return String(r.asset_type ?? '');
}

function handoverIdOf(r: DeviceRow): number | null {
  const id = Number(r.id);
  return id > 0 ? id : null;
}

function itemsPayload(rows: DeviceRow[], assetIds: number[]) {
  const want = new Set(assetIds);
  return rows
    .filter((r) => want.has(assetIdOf(r)))
    .map((r) => ({ asset_id: assetIdOf(r), asset_type: assetTypeOf(r) }));
}

export default function HandoverReportsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [assetType, setAssetType] = useState('');

  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(() => readStoredPageSize());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [formData, setFormData] = useState<AcceptanceFormData | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    void getOrgMeta()
      .then((meta) => setCompanies(meta.companies ?? []))
      .catch(() => setCompanies([]));
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('company_id', companyId);
      if (assetType) params.set('asset_type', assetType);
      const qs = params.toString();
      const res = await api<{ data: DeviceRow[] }>(
        `/api/handovers/available-devices${qs ? `?${qs}` : ''}`,
      );
      setRows(res.data ?? []);
      setSelectedAssetIds([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load available devices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, assetType]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [
        'assigned_person_name',
        'asset_tag',
        'pc_name',
        'asset_type',
        'brand',
        'model',
        'item_name',
        'gate_pass_no',
        'it_staff_name',
        'location_name',
        'company_short',
        'employee_staff_id',
        'employee_designation',
        'employee_department_name',
        'employee_work_location',
      ].some((k) => String(r[k] ?? '').toLowerCase().includes(term)),
    );
  }, [rows, q]);

  useEffect(() => {
    setPage(1);
  }, [q, companyId, assetType, pageSize, rows.length]);

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

  const selectedRows = useMemo(
    () => filtered.filter((r) => selectedAssetIds.includes(assetIdOf(r))),
    [filtered, selectedAssetIds],
  );

  const allPageSelected =
    pagedRows.length > 0 && pagedRows.every((r) => selectedAssetIds.includes(assetIdOf(r)));

  function toggleAsset(assetId: number) {
    setSelectedAssetIds((prev) =>
      prev.includes(assetId) ? prev.filter((x) => x !== assetId) : [...prev, assetId],
    );
  }

  function toggleAllPaged() {
    if (allPageSelected) {
      const pageSet = new Set(pagedRows.map((r) => assetIdOf(r)));
      setSelectedAssetIds((prev) => prev.filter((id) => !pageSet.has(id)));
      return;
    }
    const add = pagedRows.map((r) => assetIdOf(r));
    setSelectedAssetIds((prev) => Array.from(new Set([...prev, ...add])));
  }

  function handoverIdsForAssets(assetIds: number[]): number[] {
    const want = new Set(assetIds);
    const ids: number[] = [];
    for (const r of rows) {
      if (!want.has(assetIdOf(r))) continue;
      const hid = handoverIdOf(r);
      if (hid != null) ids.push(hid);
    }
    return ids;
  }

  async function generateForm(assetIds: number[]) {
    if (assetIds.length === 0) {
      toast.error('Select at least one device first');
      return;
    }
    const ids = handoverIdsForAssets(assetIds);
    const items = itemsPayload(rows, assetIds);
    toast.info(`Building acceptance form (${assetIds.length})…`);
    setPreviewOpen(true);
    setFormLoading(true);
    setFormError('');
    setFormData(null);
    try {
      const res = await api<{ data: AcceptanceFormData }>(
        '/api/handovers/acceptance-form',
        {
          method: 'POST',
          body: JSON.stringify({
            ids,
            items, // creates handover stubs from laptops/phones/pcs when missing
          }),
        },
      );
      if (!res?.data) {
        throw new Error('Empty form response from server');
      }
      setFormData(res.data);
      // Leave the reports list as soon as the handover report is generated
      void removeFromList(
        assetIds,
        assetIds.length === 1
          ? 'Form ready — item removed from Handover Reports'
          : `Form ready — removed ${assetIds.length} items from Handover Reports`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load acceptance form';
      setFormError(msg);
      toast.error(msg);
    } finally {
      setFormLoading(false);
    }
  }

  function closeForm() {
    setPreviewOpen(false);
    setFormData(null);
    setFormError('');
    dismissAcceptancePrintFrame();
  }

  async function removeFromList(assetIds: number[], message?: string) {
    if (assetIds.length === 0) return;
    const items = itemsPayload(rows, assetIds).filter(
      (it) =>
        it.asset_type === 'laptop' ||
        it.asset_type === 'mobile_phone' ||
        it.asset_type === 'other',
    );
    if (items.length === 0) return;
    try {
      await api('/api/handovers/available-devices/hide', {
        method: 'POST',
        body: JSON.stringify({ items }),
      });
      const remove = new Set(assetIds);
      setRows((prev) => prev.filter((r) => !remove.has(assetIdOf(r))));
      setSelectedAssetIds((prev) => prev.filter((id) => !remove.has(id)));
      toast.success(
        message ??
          (assetIds.length === 1
            ? 'Removed from Handover Reports'
            : `Removed ${assetIds.length} items from Handover Reports`),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove from list');
    }
  }

  async function markPrintedAndRemove(handoverIds: number[], assetIds: number[]) {
    if (handoverIds.length > 0) {
      try {
        await api('/api/handovers/acceptance-form/printed', {
          method: 'POST',
          body: JSON.stringify({ ids: handoverIds }),
        });
      } catch {
        // Fall back to asset hide below
      }
    }
    await removeFromList(
      assetIds,
      assetIds.length === 1
        ? 'Printed — removed from Handover Reports'
        : `Printed — removed ${assetIds.length} items from Handover Reports`,
    );
  }

  function printForm() {
    if (formLoading) {
      toast.error('Form is still loading — wait a moment');
      return;
    }
    if (!formData) {
      toast.error(formError || 'Wait for the form to finish loading, then try again');
      return;
    }

    const result = printAcceptanceForm(formData);
    if (!result.ok) {
      toast.error(result.reason || 'Print failed');
      return;
    }

    const handoverIds =
      formData.handover_ids && formData.handover_ids.length > 0
        ? formData.handover_ids.map(Number)
        : formData.handover_id
          ? [Number(formData.handover_id)]
          : handoverIdsForAssets(selectedAssetIds);

    const assetIds =
      selectedAssetIds.length > 0
        ? selectedAssetIds
        : rows
            .filter((r) => {
              const hid = handoverIdOf(r);
              return hid != null && handoverIds.includes(hid);
            })
            .map((r) => assetIdOf(r));

    void markPrintedAndRemove(handoverIds, assetIds);
    toast.success('Print dialog opened');
    closeForm();
  }

  useEffect(() => {
    if (!previewOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [previewOpen]);

  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeForm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewOpen]);

  return (
    <main className="page">
      <div className="no-print">
        <PageHeader
          eyebrow="Reports"
          title="Handover Reports"
          badge={<LiveRepositoryBadge />}
          subtitle="Devices stay here until you print or remove them. Removed items return only after status changes (new handover or return to available)."
        />

        <div className="asset-filter-panel" style={{ marginBottom: '1rem' }}>
          <div
            className="asset-filter-grid"
            style={{ gridTemplateColumns: 'minmax(0,1.4fr) repeat(2, minmax(0,1fr))' }}
          >
            <label className="asset-filter-field">
              <span className="asset-filter-label">Search</span>
              <input
                className="asset-filter-control"
                placeholder="Search tag, brand, model, person…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <label className="asset-filter-field">
              <span className="asset-filter-label">Company</span>
              <select
                className="asset-filter-control"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
              >
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.short_name || c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="asset-filter-field">
              <span className="asset-filter-label">Type</span>
              <select
                className="asset-filter-control"
                value={assetType}
                onChange={(e) => setAssetType(e.target.value)}
              >
                {ASSET_TYPE_OPTIONS.map((o) => (
                  <option key={o.value || 'all'} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="asset-filter-footer">
            <p className="asset-filter-count">
              {filtered.length === 0 ? (
                <>Showing <strong>0</strong> of <strong>{rows.length}</strong> devices</>
              ) : (
                <>
                  Showing <strong>{rangeFrom}–{rangeTo}</strong> of <strong>{filtered.length}</strong>
                  {filtered.length !== rows.length ? <> (filtered from {rows.length})</> : null} devices
                </>
              )}
              {selectedAssetIds.length > 0 ? (
                <>
                  {' · '}
                  <strong>{selectedAssetIds.length}</strong> selected
                </>
              ) : null}
            </p>
            <div className="asset-filter-actions">
              <button
                type="button"
                className="asset-filter-clear"
                disabled={!q && !companyId && !assetType}
                onClick={() => {
                  setQ('');
                  setCompanyId('');
                  setAssetType('');
                }}
              >
                Clear filters
              </button>
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
          </div>
        </div>

        {selectedAssetIds.length > 0 ? (
          <div className="hr-select-bar">
            <div>
              <strong>{selectedAssetIds.length}</strong> item
              {selectedAssetIds.length === 1 ? '' : 's'} selected
              {selectedRows.length > 0 ? (
                <span className="hr-select-tags">
                  {selectedRows.slice(0, 4).map((r) => (
                    <span key={assetIdOf(r)} className="hr-select-tag">
                      {typeLabel(r.asset_type)} · {dash(r.asset_tag)}
                    </span>
                  ))}
                  {selectedRows.length > 4 ? (
                    <span className="hr-select-tag">+{selectedRows.length - 4} more</span>
                  ) : null}
                </span>
              ) : null}
            </div>
            <div className="hr-select-actions">
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => setSelectedAssetIds([])}
              >
                Clear selection
              </button>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => void removeFromList(selectedAssetIds)}
                title="Remove selected items from this list"
              >
                Remove from list
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void generateForm(selectedAssetIds)}
              >
                Generate form ({selectedAssetIds.length})
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <ErrorState
            title="Failed to load available devices"
            description={error}
            onRetry={() => void load()}
          />
        ) : null}
        {loading ? <LoadingSkeleton rows={6} /> : null}

        {!loading && !error && filtered.length === 0 ? (
          <EmptyState
            title="No devices found"
            description="Available and assigned laptops & mobile phones appear here (linked to HR employees when names match)."
          />
        ) : null}

        {!loading && filtered.length > 0 ? (
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: '2.5rem' }}>
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={toggleAllPaged}
                      aria-label="Select all devices on this page"
                    />
                  </th>
                  <th>Asset</th>
                  <th>Type</th>
                  <th>Company</th>
                  <th>Employee</th>
                  <th>Staff ID</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((r) => {
                  const aid = assetIdOf(r);
                  const checked = selectedAssetIds.includes(aid);
                  const brandModel = [r.brand, r.model].filter(Boolean).join(' ');
                  const subtitle =
                    brandModel ||
                    (r.item_name ? String(r.item_name) : '') ||
                    '';
                  return (
                    <tr
                      key={`${String(r.asset_type)}-${aid}`}
                      className={checked ? 'hr-row-selected' : undefined}
                      onClick={() => toggleAsset(aid)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAsset(aid)}
                          aria-label={`Select ${dash(r.asset_tag)}`}
                        />
                      </td>
                      <td>
                        <strong>{dash(r.asset_tag)}</strong>
                        {subtitle ? (
                          <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                            {subtitle}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.45rem',
                          }}
                        >
                          <AssetIcon type={String(r.asset_type || 'laptop')} />
                          {typeLabel(r.asset_type)}
                        </span>
                      </td>
                      <td>{dash(r.company_short)}</td>
                      <td>
                        <strong>{dash(r.assigned_person_name)}</strong>
                        {r.employee_designation ? (
                          <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                            {String(r.employee_designation)}
                          </div>
                        ) : null}
                      </td>
                      <td>{dash(r.employee_staff_id)}</td>
                      <td>{dash(r.location_name || r.employee_work_location)}</td>
                      <td>
                        <StatusBadge
                          label={
                            String(r.asset_status ?? '') === 'available' ? 'Available' : 'Deployed'
                          }
                          tone={
                            String(r.asset_status ?? '') === 'available' ? 'available' : 'assigned'
                          }
                        />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-soft"
                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                            title="Generate acceptance form (uses asset + HR employee data)"
                            onClick={() => void generateForm([aid])}
                          >
                            Form
                          </button>
                          <button
                            type="button"
                            className="btn btn-soft"
                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                            onClick={() => void removeFromList([aid])}
                            title="Remove from Handover Reports"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {previewOpen
        ? createPortal(
            <>
              <div className="acceptance-overlay" role="dialog" aria-modal="true" aria-label="Acceptance form preview">
                <div className="acceptance-toolbar no-print">
                  <div>
                    <p className="eyebrow" style={{ margin: 0 }}>
                      On-screen preview · 2 pages (A4)
                    </p>
                    <h3 style={{ margin: '0.15rem 0 0' }}>
                      {formData?.employee.name || 'IT Hardware Acceptance Form'}
                    </h3>
                  <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)', fontSize: '0.82rem' }}>
                    Review the form below, then click <strong>Print / Select printer</strong> to
                    open the system print dialog (choose printer there).
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-soft" onClick={closeForm}>
                    Close
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => printForm()}
                  >
                    {formLoading ? 'Loading…' : 'Print / Select printer'}
                  </button>
                </div>
                </div>

                <div className="acceptance-preview">
                  {formLoading ? <LoadingSkeleton rows={8} /> : null}
                  {formError ? (
                    <ErrorState
                      title="Could not build form"
                      description={formError}
                      onRetry={() => void generateForm(selectedAssetIds.length ? selectedAssetIds : [])}
                    />
                  ) : null}
                  {formData ? <AcceptanceFormPrint data={formData} /> : null}
                </div>
              </div>
              <style>{`
                .acceptance-overlay {
                  position: fixed;
                  inset: 0;
                  z-index: 12000;
                  background: #e8eef5;
                  display: flex;
                  flex-direction: column;
                  overflow: auto;
                  -webkit-overflow-scrolling: touch;
                }
                .acceptance-toolbar {
                  position: sticky;
                  top: 0;
                  z-index: 2;
                  flex-shrink: 0;
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  gap: 1rem;
                  padding: 0.85rem 1.25rem;
                  background: #fff;
                  border-bottom: 1px solid var(--border);
                  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
                }
                .acceptance-toolbar .btn { cursor: pointer; }
                .acceptance-toolbar .btn:disabled { cursor: wait; }
                .acceptance-preview {
                  width: min(820px, 100%);
                  margin: 1.25rem auto 2rem;
                  padding: 0 1rem;
                }
                .acceptance-doc {
                  display: flex;
                  flex-direction: column;
                  gap: 1.25rem;
                }
                .af-page-label {
                  margin: 0 0 0.65rem;
                  font-size: 0.78rem;
                  font-weight: 700;
                  letter-spacing: 0.04em;
                  text-transform: uppercase;
                  color: #64748b;
                }
                .acceptance-form {
                  background: #fff;
                  border: 1px solid #d0d7de;
                  border-radius: 2px;
                  padding: 1.35rem 1.55rem 1.55rem;
                  color: #111;
                  font-family: "Calibri", "Segoe UI", Arial, sans-serif;
                  font-size: 11pt;
                  line-height: 1.4;
                  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
                  min-height: 297mm;
                  box-sizing: border-box;
                }
                .af-header { text-align: center; }
                .af-logo {
                  display: block;
                  max-width: 220px;
                  max-height: 72px;
                  width: auto;
                  height: auto;
                  margin: 0 auto 0.65rem;
                  object-fit: contain;
                }
                .af-header h1 {
                  margin: 0 0 0.7rem;
                  text-align: center;
                  font-size: 18pt;
                  font-weight: 700;
                  color: #000;
                  font-family: "Calibri", "Segoe UI", Arial, sans-serif;
                }
                .af-intro {
                  margin: 0 0 1rem;
                  color: #111;
                  text-align: justify;
                  font-size: 11pt;
                }
                .af-section { margin-top: 0.95rem; text-align: left; }
                .af-section h2 {
                  margin: 0 0 0.45rem;
                  font-size: 12pt;
                  font-weight: 700;
                  color: #000;
                  border-bottom: none;
                  padding-bottom: 0;
                }
                .af-section h3 {
                  margin: 0 0 0.3rem;
                  font-size: 11pt;
                  font-weight: 700;
                }
                .af-note { margin: 0 0 0.45rem; color: #111; font-size: 11pt; }
                .af-terms-lead { margin: 0 0 0.4rem; }
                .af-fields { display: grid; gap: 0.4rem; }
                .af-field {
                  display: grid;
                  grid-template-columns: 10.5rem minmax(0, 1fr);
                  gap: 0.4rem;
                  align-items: end;
                }
                .af-field-label { font-weight: 400; color: #000; white-space: nowrap; }
                .af-field-value {
                  border-bottom: 1px solid #333;
                  min-height: 1.2rem;
                  padding: 0 0.1rem 0.05rem;
                  font-weight: 600;
                }
                .af-table {
                  width: 100%;
                  border-collapse: separate;
                  border-spacing: 0;
                  table-layout: fixed;
                  font-size: 9.5pt;
                  margin-top: 0.25rem;
                  border: 1.5pt solid #000;
                }
                .af-table th,
                .af-table td {
                  border-right: 1pt solid #000;
                  border-bottom: 1pt solid #000;
                  padding: 0.35rem 0.4rem;
                  text-align: left;
                  vertical-align: middle;
                  word-break: break-word;
                  overflow-wrap: anywhere;
                  background: #fff;
                }
                .af-table th:last-child,
                .af-table td:last-child {
                  border-right: none;
                }
                .af-table tr:last-child td {
                  border-bottom: none;
                }
                .af-table th {
                  background: #f3f4f6;
                  font-weight: 700;
                  font-size: 10pt;
                  text-align: center;
                }
                .af-table td {
                  height: 1.85rem;
                  min-height: 1.85rem;
                }
                .af-remarks {
                  margin-top: 0.75rem;
                }
                .af-terms {
                  margin: 0.35rem 0 0;
                  padding-left: 1.2rem;
                  display: grid;
                  gap: 0.45rem;
                  color: #111;
                }
                .af-terms li { text-align: justify; margin: 0; }
                .af-sign-block { margin-top: 0.95rem; }
                .af-signatures { margin-top: 1.15rem; }
                .af-sign-grid {
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: 0.7rem 1.25rem;
                  margin-top: 0.7rem;
                }
                .af-sign-grid-stack {
                  grid-template-columns: 1fr;
                  max-width: 28rem;
                }
                @media print {
                  .acceptance-toolbar,
                  .no-print,
                  .af-page-label {
                    display: none !important;
                  }
                  .acceptance-overlay {
                    position: static !important;
                    background: #fff !important;
                    overflow: visible !important;
                  }
                  .acceptance-preview {
                    width: 100% !important;
                    margin: 0 !important;
                    padding: 0 !important;
                  }
                  .acceptance-form,
                  .af-page {
                    border: none !important;
                    box-shadow: none !important;
                    min-height: 0 !important;
                  }
                  .af-page-1 {
                    page-break-after: always;
                    break-after: page;
                  }
                  .af-page-2 {
                    page-break-before: always;
                    break-before: page;
                  }
                  .af-table {
                    border: 1.5pt solid #000 !important;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                  }
                  .af-table th,
                  .af-table td {
                    border-right: 1pt solid #000 !important;
                    border-bottom: 1pt solid #000 !important;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                  }
                  .af-table th:last-child,
                  .af-table td:last-child {
                    border-right: none !important;
                  }
                  .af-table tr:last-child td {
                    border-bottom: none !important;
                  }
                }
                @media (max-width: 720px) {
                  .af-field { grid-template-columns: 1fr; gap: 0.15rem; }
                  .af-sign-grid { grid-template-columns: 1fr; }
                  .acceptance-form { min-height: 0; }
                }
              `}</style>
            </>,
            document.body,
          )
        : null}

      <style>{`
        .hr-select-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem 1rem;
          margin-bottom: 0.85rem;
          padding: 0.75rem 1rem;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 12px;
        }
        .hr-select-tags {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 0.35rem;
          margin-left: 0.55rem;
        }
        .hr-select-tag {
          display: inline-block;
          background: #fff;
          border: 1px solid #bfdbfe;
          border-radius: 999px;
          padding: 0.12rem 0.55rem;
          font-size: 0.78rem;
          font-weight: 650;
          color: #1d4ed8;
        }
        .hr-select-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.45rem;
        }
        .hr-row-selected td {
          background: #f0f7ff;
        }
      `}</style>
    </main>
  );
}
