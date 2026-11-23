import { useMemo, useState } from 'react';
import PageHeader from '../components/ui/PageHeader';
import StatusBadge from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { DataTableShell } from '../components/ui/DataTable';
import {
  CCTV_CONTACTS,
  CCTV_IP_CAMERAS,
  CCTV_SYSTEMS,
  formatLkPhone,
  phoneTelHref,
} from '../data/cctvDirectory';

type CctvTab = 'contacts' | 'systems' | 'ip';

function cellDash(v: unknown): string {
  if (v == null || String(v).trim() === '') return '—';
  return String(v);
}

export default function CctvPage() {
  const [tab, setTab] = useState<CctvTab>('contacts');
  const [q, setQ] = useState('');

  const contactRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return CCTV_CONTACTS;
    return CCTV_CONTACTS.filter((r) => {
      const hay = [r.location, r.servicePerson, ...r.phones].join(' ').toLowerCase();
      return hay.includes(term);
    });
  }, [q]);

  const systemRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return CCTV_SYSTEMS;
    return CCTV_SYSTEMS.filter((r) => {
      const hay = [
        r.location,
        r.deviceType,
        r.brand,
        r.model,
        r.serialNumber,
        r.recordingDuration,
        r.hdd,
        r.remark,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(term);
    });
  }, [q]);

  const ipRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return CCTV_IP_CAMERAS;
    return CCTV_IP_CAMERAS.filter((r) => {
      const hay = [
        r.floor,
        r.item,
        r.type,
        r.brand,
        r.serialNumber,
        r.defaultIp,
        r.location,
        r.invoiceNo,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(term);
    });
  }, [q]);

  const count =
    tab === 'contacts' ? contactRows.length : tab === 'systems' ? systemRows.length : ipRows.length;

  return (
    <main className="page page--fill">
      <PageHeader
        eyebrow="Asset Management"
        title="CCTV"
        subtitle="Branch contacts, DVR / NVR inventory, and Head Office IP cameras"
      />

      <div className="cctv-panel">
        <div className="asset-filter-panel" style={{ marginBottom: '0.85rem' }}>
          <div
            className="asset-filter-grid"
            style={{ gridTemplateColumns: 'minmax(0, 1.6fr) auto' }}
          >
            <label className="asset-filter-field">
              <span className="asset-filter-label">Search</span>
              <input
                className="asset-filter-control"
                placeholder={
                  tab === 'contacts'
                    ? 'Search location, person, phone…'
                    : tab === 'systems'
                      ? 'Search location, model, serial…'
                      : 'Search floor, IP, serial, room…'
                }
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <div className="asset-filter-field" style={{ justifyContent: 'flex-end' }}>
              <span className="asset-filter-label">&nbsp;</span>
              <div className="tabs-secondary" style={{ margin: 0 }}>
                {(
                  [
                    ['contacts', 'Contacts'],
                    ['systems', 'DVR / NVR'],
                    ['ip', 'HO IP cameras'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`tab-btn${tab === id ? ' active' : ''}`}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DataTableShell
          toolbar={
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.82rem' }}>
              {tab === 'contacts'
                ? 'Service contacts by branch / site'
                : tab === 'systems'
                  ? 'Site DVR / NVR / SIM camera inventory (credentials stay offline)'
                  : 'Head Office IP camera & POE switch register'}
              {' · '}
              {count} row{count === 1 ? '' : 's'}
            </p>
          }
        >
          {tab === 'contacts' ? (
            contactRows.length === 0 ? (
              <EmptyState title="No contacts" description="Try another search." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '3rem' }}>#</th>
                    <th>Location</th>
                    <th>Service person</th>
                    <th>Contact numbers</th>
                  </tr>
                </thead>
                <tbody>
                  {contactRows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>
                        <strong>{r.location}</strong>
                      </td>
                      <td>{cellDash(r.servicePerson)}</td>
                      <td>
                        {r.phones.length === 0 ? (
                          '—'
                        ) : (
                          <div className="cctv-phones">
                            {r.phones.map((p) => (
                              <a key={p} className="cctv-phone" href={phoneTelHref(p)}>
                                {formatLkPhone(p)}
                              </a>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : null}

          {tab === 'systems' ? (
            systemRows.length === 0 ? (
              <EmptyState title="No systems" description="Try another search." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '3rem' }}>#</th>
                    <th>Location</th>
                    <th>Type</th>
                    <th>Brand / Model</th>
                    <th>Channels</th>
                    <th>Cameras</th>
                    <th>Recording</th>
                    <th>HDD</th>
                    <th>S/N</th>
                    <th>Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {systemRows.map((r) => (
                    <tr key={`${r.id}-${r.serialNumber}`}>
                      <td>{r.id}</td>
                      <td>
                        <strong>{r.location}</strong>
                      </td>
                      <td>{cellDash(r.deviceType)}</td>
                      <td>
                        <div>{cellDash(r.brand)}</div>
                        <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                          {cellDash(r.model)}
                        </div>
                      </td>
                      <td>{cellDash(r.channels)}</td>
                      <td>{cellDash(r.cameras)}</td>
                      <td>{cellDash(r.recordingDuration)}</td>
                      <td>{cellDash(r.hdd)}</td>
                      <td>
                        <span className="cctv-sn" title={r.serialNumber}>
                          {cellDash(r.serialNumber)}
                        </span>
                      </td>
                      <td>
                        {r.remark ? (
                          <StatusBadge
                            tone={/not\s*working/i.test(r.remark) ? 'warning' : 'neutral'}
                            label={r.remark}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : null}

          {tab === 'ip' ? (
            ipRows.length === 0 ? (
              <EmptyState title="No IP cameras" description="Try another search." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '3rem' }}>#</th>
                    <th>Floor</th>
                    <th>Item</th>
                    <th>Brand / Type</th>
                    <th>Default IP</th>
                    <th>S/N</th>
                    <th>Location</th>
                    <th>Invoice</th>
                    <th>Warranty</th>
                  </tr>
                </thead>
                <tbody>
                  {ipRows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>{cellDash(r.floor)}</td>
                      <td>
                        <strong>{r.item}</strong>
                      </td>
                      <td>
                        <div>{cellDash(r.brand)}</div>
                        <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                          {cellDash(r.type)}
                        </div>
                      </td>
                      <td>
                        <code className="cctv-ip">{cellDash(r.defaultIp)}</code>
                      </td>
                      <td>
                        <span className="cctv-sn" title={r.serialNumber}>
                          {cellDash(r.serialNumber)}
                        </span>
                      </td>
                      <td>{cellDash(r.location)}</td>
                      <td>
                        <div>{cellDash(r.invoiceNo)}</div>
                        <div style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
                          {cellDash(r.invoiceDate)}
                        </div>
                      </td>
                      <td>{cellDash(r.warranty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : null}
        </DataTableShell>

        <style>{`
          .cctv-phones {
            display: flex;
            flex-wrap: wrap;
            gap: 0.35rem 0.65rem;
          }
          .cctv-phone {
            color: #1d4ed8;
            font-weight: 650;
            text-decoration: none;
            white-space: nowrap;
          }
          .cctv-phone:hover { text-decoration: underline; }
          .cctv-sn {
            display: inline-block;
            max-width: 14rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 0.8rem;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          }
          .cctv-ip {
            font-size: 0.82rem;
            background: #f1f5f9;
            border-radius: 6px;
            padding: 0.12rem 0.4rem;
          }
        `}</style>
      </div>
    </main>
  );
}
