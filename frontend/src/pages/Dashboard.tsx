import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../auth/AuthContext';
import { loadDashboard } from '../services/api';
import { getDummyDashboardData } from '../services/dashboardData';
import type { DashboardPayload } from '../types/dashboard';

const COMPANY_COLORS: Record<string, string> = {
  IT: '#2563eb', // Traders — blue
  IMS: '#16a34a', // Motor Spares — green
  ISP: '#f59e0b', // Service Park — amber
  FOTON: '#ea580c', // Foton — orange
  OTHER: '#64748b', // Others — slate
};

const TYPE_COLORS: Record<string, string> = {
  laptop: '#2563eb',
  mobile_phone: '#16a34a',
  pc: '#7c3aed',
  other: '#64748b',
  printer: '#0891b2',
};

const STATUS_COLORS: Record<string, string> = {
  available: '#3b82f6', // blue
  deployed: '#22c55e', // green
  under_repair: '#f59e0b', // amber
  disposed: '#ef4444', // red
};

const COMPANY_DISPLAY: Record<string, string> = {
  IT: 'ITL',
  IMS: 'IMS',
  ISP: 'ISP',
  FOTON: 'Foton',
  OTHER: 'Others',
};

type StatTone = 'blue' | 'green' | 'yellow' | 'orange' | 'slate' | 'purple' | 'cyan';
type StatIcon = 'laptop' | 'phone' | 'pc' | 'box' | 'wrench' | 'shield';

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardPayload>(getDummyDashboardData());
  const [source, setSource] = useState<'api' | 'dummy'>('dummy');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadDashboard(90).then((result) => {
      if (cancelled) return;
      setData(result.data);
      setSource(result.source);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = useMemo(() => {
    const h = now.getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, [now]);

  const displayName = useMemo(() => {
    const raw = (user?.name ?? '').trim();
    if (!raw) return 'there';
    // Prefer first given name; skip title prefixes (Mr/Mrs/Ms/Miss)
    const cleaned = raw.replace(/^(mr|mrs|ms|miss)\.?\s+/i, '').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    return parts[0] || raw;
  }, [user?.name]);
  const clockParts = useMemo(() => {
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const m = time.match(/^(.+?)\s*(AM|PM)$/i);
    return {
      time: m ? m[1] : time,
      ampm: m ? m[2].toUpperCase() : '',
      date: now.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    };
  }, [now]);
  const s = data.stats;
  const byType = data.assetsByType ?? [];
  const laptopCount = s.totalLaptops ?? byType.find((t) => t.category === 'laptop')?.count ?? 0;
  const mobileCount = s.totalMobilePhones ?? byType.find((t) => t.category === 'mobile_phone')?.count ?? 0;
  const pcCount = s.totalPcs ?? byType.find((t) => t.category === 'pc')?.count ?? 0;
  const otherCount = s.totalOtherAssets ?? byType.find((t) => t.category === 'other')?.count ?? 0;
  const repairCount = Number(s.maintenanceAssets ?? 0);
  const warrantyDue = Number(s.warrantyDueCount ?? data.upcomingWarranties?.length ?? 0);

  const assetsByCompany = useMemo(
    () =>
      (data.assetsByCompany ?? [])
        .map((c) => {
          const code = String(c.companyCode ?? '').toUpperCase();
          return {
            ...c,
            companyCode: code,
            name: COMPANY_DISPLAY[code] ?? (c.shortName || code),
            value: Number(c.count ?? 0),
            color: COMPANY_COLORS[code] ?? '#64748b',
          };
        })
        .filter((c) => c.companyCode !== 'FOTON' && c.value > 0),
    [data.assetsByCompany],
  );

  const totalAssetsByCompany = useMemo(
    () => assetsByCompany.reduce((sum, row) => sum + row.value, 0),
    [assetsByCompany],
  );

  const companyLegend = useMemo(() => {
    const total = totalAssetsByCompany || 1;
    return assetsByCompany.map((c) => ({
      ...c,
      pct: Math.round((c.value / total) * 100),
    }));
  }, [assetsByCompany, totalAssetsByCompany]);

  const assignedCount = Number(s.assignedAssets ?? 0);
  const availableCount = Number(s.availableAssets ?? 0);
  const deployTotal = assignedCount + availableCount;
  const allocatedPct = deployTotal > 0 ? ((assignedCount / deployTotal) * 100).toFixed(1) : '0.0';

  const statusChartData = useMemo(
    () =>
      (data.assetsByStatus ?? [])
        .filter((row) => row.status === 'available' || row.status === 'deployed')
        .map((row) => ({
          ...row,
          label:
            row.status === 'deployed'
              ? `Assigned (${Number(row.count ?? 0)})`
              : `Available (${Number(row.count ?? 0)})`,
          count: Number(row.count ?? 0),
        })),
    [data.assetsByStatus],
  );

  const typeChartData = useMemo(
    () =>
      byType
        .map((row) => ({
          name: row.label || row.category,
          category: row.category,
          value: Number(row.count ?? 0),
          color: TYPE_COLORS[row.category] ?? '#64748b',
        }))
        .filter((row) => row.value > 0),
    [byType],
  );

  const totalByType = useMemo(
    () => typeChartData.reduce((sum, row) => sum + row.value, 0),
    [typeChartData],
  );

  const chartTooltip = {
    contentStyle: {
      borderRadius: 10,
      border: '1px solid #e2e8f0',
      boxShadow: '0 8px 20px rgba(15,23,42,0.08)',
      fontSize: 13,
    },
  };

  return (
    <main className="page">
      <section className="hero-banner">
        <div className="hero-copy">
          <div className="hero-title-row">
            <h1 title={user?.name || undefined}>
              {greeting}, {displayName}
            </h1>
            <span className={`hero-status${source === 'api' ? ' ok' : ' warn'}`}>
              <span className="hero-status-dot" aria-hidden />
              {source === 'api' ? 'All Systems Operational' : 'Sample data mode'}
            </span>
          </div>
          <p className="hero-overview">
            Central IT overview across <strong>Indra Traders (ITL)</strong>,{' '}
            <strong>Motor Spares (IMS)</strong>, and <strong>Service Park (ISP)</strong>.
          </p>
          <p className="hero-motto">
            <svg className="hero-motto-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
              <path d="M9.5 12l1.8 1.8L15 10" />
            </svg>
            Secure. Track. Empower. — Every laptop, PC, and phone under control.
          </p>
        </div>
        <div className="clock-box" aria-live="polite">
          <strong className="clock-time">
            {clockParts.time}
            {clockParts.ampm ? <span className="clock-ampm"> {clockParts.ampm}</span> : null}
          </strong>
          <span className="clock-date">
            <svg className="clock-cal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M16 3v4M8 3v4M3 11h18" />
            </svg>
            {clockParts.date}
          </span>
        </div>
      </section>

      {source === 'dummy' ? (
        <p className="error-text">Showing sample data — API offline or unauthorized.</p>
      ) : null}

      <section className="stat-row">
        <Stat label="Total Laptops" value={fmt(laptopCount)} tone="blue" icon="laptop" badge="Fleet" badgeTone="blue" />
        <Stat label="Mobile Phones" value={fmt(mobileCount)} tone="green" icon="phone" badge="SIM" badgeTone="green" />
        <Stat label="Desktop PCs" value={fmt(pcCount)} tone="purple" icon="pc" badge="Hardware" badgeTone="purple" />
        <Stat label="Other Assets" value={fmt(otherCount)} tone="slate" icon="box" badge="Inventory" badgeTone="slate" />
        <Stat
          label="Under Repair"
          value={fmt(repairCount)}
          tone="yellow"
          icon="wrench"
          badge={repairCount > 0 ? 'Action' : 'Clear'}
          badgeTone={repairCount > 0 ? 'yellow' : 'green'}
        />
        <Stat
          label="Warranty Due"
          value={fmt(warrantyDue)}
          tone="orange"
          icon="shield"
          badge={`${data.warrantyDays ?? 90}d`}
          badgeTone="orange"
        />
      </section>

      <section className="card performance-card">
        <div className="perf-head">
          <div>
            <h2 style={{ margin: 0 }}>Inventory performance</h2>
            <p style={{ margin: '0.35rem 0 0', color: 'var(--muted)', fontSize: '0.9rem' }}>
              Live asset mix, company distribution, and deployment status across Indra Group.
            </p>
          </div>
          <div className="perf-boxes">
            <div className="perf-pill tone-blue">
              <span className="perf-box-icon" aria-hidden>
                <PerfGlyph kind="companies" />
              </span>
              <div>
                <span>Companies</span>
                <strong>{assetsByCompany.length} Active</strong>
              </div>
            </div>
            <div className="perf-pill tone-green">
              <span className="perf-box-icon" aria-hidden>
                <PerfGlyph kind="assigned" />
              </span>
              <div>
                <span>Assigned</span>
                <strong>
                  {fmt(assignedCount)} ({allocatedPct}%)
                </strong>
              </div>
            </div>
            <div className="perf-pill tone-sky">
              <span className="perf-box-icon" aria-hidden>
                <PerfGlyph kind="available" />
              </span>
              <div>
                <span>In Stock</span>
                <strong>{fmt(availableCount)} Available</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="chart-grid">
          <div className="chart-panel">
            <div className="chart-panel-head">
              <h3 className="chart-title">Assets by company</h3>
              <span className="chart-meta">{fmt(totalAssetsByCompany)} Total Units</span>
            </div>
            <div className="donut-wrap">
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={assetsByCompany}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={58}
                      outerRadius={88}
                      paddingAngle={3}
                      stroke="#fff"
                      strokeWidth={2}
                    >
                      {assetsByCompany.map((entry) => (
                        <Cell key={entry.companyCode} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      {...chartTooltip}
                      formatter={(value: number, name: string) => [`${fmt(value)} assets`, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="donut-center" aria-hidden>
                <span>Total Assets</span>
                <strong>{fmt(totalAssetsByCompany)}</strong>
                <em className="donut-verified">100% Verified</em>
              </div>
            </div>
            <ul className="company-legend">
              {companyLegend.map((entry) => (
                <li key={entry.companyCode}>
                  <span className="legend-dot" style={{ background: entry.color }} />
                  <span className="legend-name">{entry.name}</span>
                  <span className="legend-pct">{entry.pct}%</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="chart-panel">
            <div className="chart-panel-head">
              <h3 className="chart-title">Asset deployment status</h3>
              <span className="chart-pill-ok">{allocatedPct}% Allocated</span>
            </div>
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={statusChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip {...chartTooltip} formatter={(value: number) => [fmt(value), 'Assets']} />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]} maxBarSize={64}>
                    {statusChartData.map((row) => (
                      <Cell key={row.status} fill={STATUS_COLORS[row.status] ?? '#64748b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-panel">
            <div className="chart-panel-head">
              <h3 className="chart-title">Assets by type</h3>
              <span className="chart-meta">{fmt(totalByType)} Total Units</span>
            </div>
            <div style={{ width: '100%', height: 260 }}>
              {typeChartData.length === 0 ? (
                <p style={{ color: 'var(--muted)' }}>No inventory recorded yet.</p>
              ) : (
                <ResponsiveContainer>
                  <BarChart data={typeChartData} margin={{ top: 22, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip {...chartTooltip} formatter={(value: number) => [fmt(value), 'Assets']} />
                    <Bar dataKey="value" name="Assets" radius={[8, 8, 0, 0]} maxBarSize={48}>
                      {typeChartData.map((entry) => (
                        <Cell key={entry.category} fill={entry.color} />
                      ))}
                      <LabelList dataKey="value" position="top" style={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Warranty &amp; expiry alerts</h2>
            <p style={{ margin: '0.35rem 0 0', color: 'var(--muted)', fontSize: '0.9rem' }}>
              Assets with warranty ending within the next {data.warrantyDays ?? 90} days (or already expired)
            </p>
          </div>
          <Link to="/reports/maintenance" style={{ fontSize: '0.88rem' }}>
            Full maintenance report →
          </Link>
        </div>
        {(data.upcomingWarranties ?? []).length === 0 ? (
          <p style={{ margin: '1rem 0 0', color: 'var(--muted)' }}>No warranties due in this window.</p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: '0.85rem' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Type</th>
                  <th>Company</th>
                  <th>Holder / name</th>
                  <th>Expires</th>
                  <th>Days left</th>
                </tr>
              </thead>
              <tbody>
                {data.upcomingWarranties.map((w) => (
                  <tr key={`${w.category}-${w.id}`}>
                    <td>{w.assetTag}</td>
                    <td>{String(w.category).replace(/_/g, ' ')}</td>
                    <td>{w.company}</td>
                    <td>{w.pcName || '—'}</td>
                    <td>{w.warrantyExpiresOn}</td>
                    <td
                      style={{
                        fontWeight: 650,
                        color:
                          w.daysRemaining < 0 ? '#dc2626' : w.daysRemaining <= 30 ? '#d97706' : '#16a34a',
                      }}
                    >
                      {w.daysRemaining}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <style>{`
        .hero-banner {
          display: flex;
          justify-content: space-between;
          gap: 1.5rem;
          flex-wrap: wrap;
          align-items: flex-start;
          background: linear-gradient(105deg, #0b1220 0%, #111827 42%, #1e3a5f 100%);
          color: #fff;
          border-radius: 18px;
          padding: 1.45rem 1.55rem;
          margin-bottom: 1.1rem;
          box-shadow: 0 12px 32px rgba(17, 24, 39, 0.22);
        }
        .hero-copy {
          flex: 1;
          min-width: min(100%, 18rem);
        }
        .hero-title-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.65rem 0.85rem;
          margin-bottom: 0.45rem;
        }
        .hero-banner h1 {
          margin: 0;
          font-size: 1.7rem;
          font-weight: 750;
          letter-spacing: -0.03em;
          line-height: 1.15;
        }
        .hero-status {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.28rem 0.7rem;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 650;
          letter-spacing: 0.01em;
          border: 1px solid transparent;
          white-space: nowrap;
        }
        .hero-status.ok {
          background: rgba(22, 163, 74, 0.16);
          border-color: rgba(34, 197, 94, 0.28);
          color: #86efac;
        }
        .hero-status.warn {
          background: rgba(245, 158, 11, 0.16);
          border-color: rgba(245, 158, 11, 0.28);
          color: #fcd34d;
        }
        .hero-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: currentColor;
          box-shadow: 0 0 0 3px rgba(134, 239, 172, 0.18);
        }
        .hero-status.warn .hero-status-dot {
          box-shadow: 0 0 0 3px rgba(252, 211, 77, 0.18);
        }
        .hero-overview {
          margin: 0 0 0.85rem;
          color: #94a3b8;
          max-width: 40rem;
          font-size: 0.95rem;
          line-height: 1.45;
        }
        .hero-overview strong {
          color: #f8fafc;
          font-weight: 650;
        }
        .hero-motto {
          margin: 0;
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          font-size: 0.92rem;
          font-weight: 600;
          letter-spacing: 0.01em;
          color: #60a5fa;
          max-width: 38rem;
          line-height: 1.4;
        }
        .hero-motto-icon {
          width: 16px;
          height: 16px;
          flex-shrink: 0;
        }
        .clock-box {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.3rem;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 14px;
          padding: 0.85rem 1.15rem;
          min-width: 168px;
          align-self: flex-start;
        }
        .clock-time {
          margin: 0;
          font-size: 1.65rem;
          font-weight: 750;
          letter-spacing: -0.03em;
          color: #fff;
          line-height: 1.1;
        }
        .clock-ampm {
          color: #3b82f6;
          font-size: 0.95rem;
          font-weight: 700;
          letter-spacing: 0.02em;
        }
        .clock-date {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          color: #94a3b8;
          font-size: 0.8rem;
          font-weight: 500;
          line-height: 1.2;
          white-space: nowrap;
        }
        .clock-cal-icon {
          width: 13px;
          height: 13px;
          flex-shrink: 0;
          opacity: 0.9;
        }
        .stat-row {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
          gap: 0.85rem;
          margin: 1rem 0;
        }
        .stat-tile {
          border-radius: 14px;
          padding: 0.9rem 1rem 0.95rem;
          border: 1px solid #e2e8f0;
          background: #fff;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
          display: flex;
          flex-direction: column;
          gap: 0.65rem;
          min-height: 108px;
          position: relative;
          overflow: hidden;
        }
        .stat-tile::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 3px;
        }
        .stat-tile.tone-blue::after { background: #2563eb; }
        .stat-tile.tone-green::after { background: #16a34a; }
        .stat-tile.tone-purple::after { background: #7c3aed; }
        .stat-tile.tone-cyan::after { background: #0891b2; }
        .stat-tile.tone-yellow::after { background: #f59e0b; }
        .stat-tile.tone-orange::after { background: #ea580c; }
        .stat-tile.tone-slate::after { background: #64748b; }
        .stat-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .stat-tile .stat-icon {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          display: grid;
          place-items: center;
          flex-shrink: 0;
          background: #f1f5f9;
          color: #64748b;
        }
        .stat-tile.tone-blue .stat-icon { background: #eff6ff; color: #2563eb; }
        .stat-tile.tone-green .stat-icon { background: #f0fdf4; color: #16a34a; }
        .stat-tile.tone-purple .stat-icon { background: #f5f3ff; color: #7c3aed; }
        .stat-tile.tone-cyan .stat-icon { background: #ecfeff; color: #0891b2; }
        .stat-tile.tone-yellow .stat-icon { background: #fffbeb; color: #d97706; }
        .stat-tile.tone-orange .stat-icon { background: #fff7ed; color: #ea580c; }
        .stat-tile.tone-slate .stat-icon { background: #f1f5f9; color: #475569; }
        .stat-tile .stat-icon svg {
          width: 15px;
          height: 15px;
        }
        .stat-tile .label {
          margin: 0;
          font-size: 0.66rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #94a3b8;
          line-height: 1.25;
        }
        .stat-value-row {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          flex-wrap: wrap;
        }
        .stat-tile .value {
          margin: 0;
          font-size: 1.55rem;
          font-weight: 750;
          letter-spacing: -0.03em;
          color: #0f172a;
          line-height: 1;
        }
        .stat-badge {
          display: inline-flex;
          align-items: center;
          padding: 0.18rem 0.5rem;
          border-radius: 999px;
          font-size: 0.68rem;
          font-weight: 650;
          line-height: 1;
        }
        .stat-badge.tone-green { background: #dcfce7; color: #15803d; }
        .stat-badge.tone-blue { background: #dbeafe; color: #1d4ed8; }
        .stat-badge.tone-purple { background: #ede9fe; color: #6d28d9; }
        .stat-badge.tone-cyan { background: #cffafe; color: #0e7490; }
        .stat-badge.tone-yellow { background: #fef3c7; color: #b45309; }
        .stat-badge.tone-orange { background: #ffedd5; color: #c2410c; }
        .stat-badge.tone-slate { background: #e2e8f0; color: #475569; }
        .performance-card {
          margin-top: 0.25rem;
          padding: 1.15rem 1.2rem 1.25rem;
        }
        .perf-head {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 1rem;
          align-items: flex-start;
        }
        .perf-boxes {
          display: flex;
          flex-wrap: wrap;
          gap: 0.55rem;
        }
        .perf-pill {
          border-radius: 999px;
          padding: 0.45rem 0.85rem 0.45rem 0.45rem;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 0.55rem;
          border: 1px solid transparent;
        }
        .perf-pill.tone-blue {
          background: #eff6ff;
          border-color: #dbeafe;
        }
        .perf-pill.tone-green {
          background: #f0fdf4;
          border-color: #dcfce7;
        }
        .perf-pill.tone-sky {
          background: #f0f9ff;
          border-color: #bae6fd;
        }
        .perf-box-icon {
          width: 30px;
          height: 30px;
          border-radius: 999px;
          background: #fff;
          color: #2563eb;
          display: inline-grid;
          place-items: center;
          flex-shrink: 0;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
          overflow: hidden;
          line-height: 0;
        }
        .perf-pill.tone-green .perf-box-icon { color: #16a34a; }
        .perf-pill.tone-sky .perf-box-icon { color: #0284c7; }
        .perf-box-icon svg {
          width: 15px;
          height: 15px;
          display: block;
          margin: 0;
        }
        .perf-pill > div > span {
          display: block;
          font-size: 0.62rem;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-weight: 650;
        }
        .perf-pill strong {
          display: block;
          margin-top: 0.05rem;
          font-size: 0.92rem;
          color: #0f172a;
          letter-spacing: -0.02em;
          font-weight: 700;
        }
        .chart-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.9rem;
        }
        .chart-panel {
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 0.85rem 0.9rem 0.95rem;
          background: #fff;
          min-width: 0;
        }
        .chart-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          margin-bottom: 0.35rem;
        }
        .chart-title {
          margin: 0;
          font-size: 0.72rem;
          font-weight: 750;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #64748b;
        }
        .chart-meta {
          font-size: 0.75rem;
          color: #94a3b8;
          font-weight: 600;
          white-space: nowrap;
        }
        .chart-pill-ok {
          display: inline-flex;
          align-items: center;
          padding: 0.2rem 0.55rem;
          border-radius: 999px;
          background: #dcfce7;
          color: #15803d;
          font-size: 0.72rem;
          font-weight: 700;
          white-space: nowrap;
        }
        .donut-wrap {
          position: relative;
        }
        .donut-center {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          text-align: center;
        }
        .donut-center span {
          font-size: 0.68rem;
          color: #94a3b8;
          font-weight: 650;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .donut-center strong {
          margin-top: 0.1rem;
          font-size: 1.45rem;
          color: #0f172a;
          letter-spacing: -0.02em;
        }
        .donut-verified {
          margin: 0.15rem 0 0;
          font-style: normal;
          font-size: 0.72rem;
          font-weight: 700;
          color: #16a34a;
        }
        .company-legend {
          list-style: none;
          margin: 0.35rem 0 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.55rem 1rem;
          justify-content: center;
        }
        .company-legend li {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          min-width: 0;
        }
        .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          flex-shrink: 0;
        }
        .legend-name {
          font-size: 0.82rem;
          color: #334155;
          font-weight: 650;
        }
        .legend-pct {
          font-size: 0.78rem;
          color: #94a3b8;
          font-weight: 600;
        }
        @media (max-width: 1100px) {
          .chart-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 720px) {
          .clock-box { width: 100%; }
        }
      `}</style>
    </main>
  );
}

function fmt(n: number | undefined): string {
  return Number(n ?? 0).toLocaleString('en-LK');
}

function Stat({
  label,
  value,
  tone,
  icon,
  badge,
  badgeTone,
}: {
  label: string;
  value: string;
  tone: StatTone;
  icon: StatIcon;
  badge?: string;
  badgeTone?: StatTone;
}) {
  return (
    <article className={`stat-tile tone-${tone}`}>
      <div className="stat-top">
        <p className="label">{label}</p>
        <span className="stat-icon" aria-hidden>
          <StatGlyph kind={icon} />
        </span>
      </div>
      <div className="stat-value-row">
        <p className="value">{value}</p>
        {badge ? <span className={`stat-badge tone-${badgeTone ?? tone}`}>{badge}</span> : null}
      </div>
    </article>
  );
}

function StatGlyph({ kind }: { kind: StatIcon }) {
  if (kind === 'laptop') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M2 20h20" />
      </svg>
    );
  }
  if (kind === 'phone') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" />
      </svg>
    );
  }
  if (kind === 'pc') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  }
  if (kind === 'box') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
        <path d="M3 8l9 5 9-5M12 13v10" />
      </svg>
    );
  }
  if (kind === 'wrench') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-2.1-2.1 2.2-2z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
      <path d="M9.5 12l1.8 1.8L15 10" />
    </svg>
  );
}

function PerfGlyph({ kind }: { kind: 'companies' | 'assigned' | 'available' }) {
  if (kind === 'companies') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21h18" />
        <path d="M5 21V7l7-4 7 4v14" />
        <path d="M9 21v-6h6v6" />
      </svg>
    );
  }
  if (kind === 'assigned') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}
