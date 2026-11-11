import type { DashboardPayload } from '../types/dashboard';
import { getDummyDashboardData } from './dashboardData';
import { api } from './client';

/**
 * Loads live dashboard; falls back to dummy only if the request fails.
 * Empty VITE_API_URL means same-origin (Vite /api proxy) — that is valid.
 * Caches successful responses briefly to make revisiting the dashboard feel instant.
 */
export async function loadDashboard(warrantyDays: 30 | 60 | 90 = 90): Promise<{ data: DashboardPayload; source: 'api' | 'dummy' }> {
  const cacheKey = `itam_dash_${warrantyDays}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { at: number; data: DashboardPayload };
      if (parsed?.data && Date.now() - parsed.at < 60_000) {
        // Refresh in background
        void api<Record<string, unknown>>(`/api/dashboard?warranty_days=${warrantyDays}`)
          .then((json) => {
            const data = normalizeDashboard(json);
            sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data }));
          })
          .catch(() => undefined);
        return { data: parsed.data, source: 'api' };
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const json = await api<Record<string, unknown>>(`/api/dashboard?warranty_days=${warrantyDays}`);
    const data = normalizeDashboard(json);
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data }));
    } catch {
      /* ignore */
    }
    return { data, source: 'api' };
  } catch {
    return { data: getDummyDashboardData(), source: 'dummy' };
  }
}

function normalizeDashboard(json: Record<string, unknown>): DashboardPayload {
  const stats = (json.stats ?? {}) as Record<string, number>;
  const byCompany = Array.isArray(json.assetsByCompany) ? json.assetsByCompany : [];
  const byStatus = Array.isArray(json.assetsByStatus) ? json.assetsByStatus : [];
  const byType = Array.isArray(json.assetsByType) ? json.assetsByType : [];
  const warranties = Array.isArray(json.upcomingWarranties) ? json.upcomingWarranties : [];
  const activity = Array.isArray(json.recentActivity) ? json.recentActivity : [];

  const statusLabel: Record<string, string> = {
    available: 'Available',
    deployed: 'Assigned',
    under_repair: 'Maintenance',
    lost: 'Lost / stolen',
    disposed: 'Retired',
  };

  return {
    stats: {
      totalAssets: Number(stats.totalAssets ?? 0),
      totalValueLkr: Number(stats.totalValueLkr ?? 0),
      assignedAssets: Number(stats.assignedAssets ?? 0),
      availableAssets: Number(stats.availableAssets ?? 0),
      maintenanceAssets: Number(stats.maintenanceAssets ?? 0),
      lostAssets: Number(stats.lostAssets ?? 0),
      totalUsers: Number(stats.totalUsers ?? 0),
      totalLocations: Number(stats.totalLocations ?? 0),
      totalSuppliers: Number(stats.totalSuppliers ?? 0),
      totalCredentials: Number(stats.totalCredentials ?? 0),
      totalLaptops: Number(stats.totalLaptops ?? 0),
      totalMobilePhones: Number(stats.totalMobilePhones ?? 0),
      totalPcs: Number(stats.totalPcs ?? 0),
      totalOtherAssets: Number(stats.totalOtherAssets ?? 0),
      warrantyDueCount: Number(stats.warrantyDueCount ?? 0),
    },
    assetsByCompany: byCompany.map((row: Record<string, unknown>) => ({
      companyCode: String(row.code ?? row.short_name ?? row.companyCode ?? '—'),
      companyName: String(row.company_name ?? row.companyName ?? ''),
      shortName: String(row.short_name ?? row.shortName ?? ''),
      count: Number(row.total_assets ?? row.count ?? 0),
      valueLkr: Number(row.total_value_lkr ?? row.valueLkr ?? 0),
    })),
    assetsByStatus: byStatus.map((row: Record<string, unknown>) => {
      const status = String(row.status ?? 'available') as keyof typeof statusLabel;
      return {
        status: status as 'available' | 'deployed' | 'under_repair' | 'lost' | 'disposed',
        label: statusLabel[status] ?? status,
        count: Number(row.asset_count ?? row.count ?? 0),
      };
    }),
    assetsByType: byType.map((row: Record<string, unknown>) => ({
      category: String(row.category ?? ''),
      label: String(row.label ?? row.category ?? ''),
      count: Number(row.count ?? 0),
    })),
    upcomingWarranties: warranties.map((row: Record<string, unknown>, i: number) => ({
      id: Number(row.id ?? i),
      assetTag: String(row.asset_tag ?? row.assetTag ?? ''),
      pcName: (row.pc_name ?? row.pcName ?? null) as string | null,
      company: String(row.company ?? ''),
      category: String(row.category ?? ''),
      warrantyExpiresOn: String(row.warranty_expires_on ?? row.warrantyExpiresOn ?? ''),
      daysRemaining: Number(row.days_remaining ?? row.daysRemaining ?? 0),
    })),
    recentActivity: activity.map((row: Record<string, unknown>, i: number) => ({
      id: String(row.id ?? i),
      title: String(row.title ?? 'Activity'),
      description: row.description != null ? String(row.description) : undefined,
      user: row.user != null ? String(row.user) : undefined,
      time: formatActivityTime(String(row.time ?? '')),
      tone: (row.tone as 'primary' | 'security' | 'success' | 'warning' | undefined) ?? 'primary',
    })),
    warrantyDays: Number(json.warrantyDays ?? 90),
  };
}

function formatActivityTime(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const diff = Date.now() - d.getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-LK');
}

export { formatLkr, getDummyDashboardData } from './dashboardData';
