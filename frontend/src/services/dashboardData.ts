import type { DashboardPayload } from '../types/dashboard';

/** Offline / unauthorized fallback sample payload. */
export function getDummyDashboardData(): DashboardPayload {
  return {
    stats: {
      totalAssets: 412,
      totalValueLkr: 48_750_000,
      assignedAssets: 301,
      availableAssets: 64,
      maintenanceAssets: 28,
      lostAssets: 3,
      totalUsers: 48,
      totalLocations: 12,
      totalSuppliers: 26,
      totalCredentials: 186,
      totalLaptops: 168,
      totalMobilePhones: 84,
      totalPcs: 112,
      totalOtherAssets: 48,
      warrantyDueCount: 12,
    },
    assetsByCompany: [
      {
        companyCode: 'IT',
        companyName: 'Indra Traders',
        shortName: 'Traders',
        count: 178,
        valueLkr: 21_200_000,
      },
      {
        companyCode: 'IMS',
        companyName: 'Indra Motor Spares',
        shortName: 'Motor Spares',
        count: 134,
        valueLkr: 15_800_000,
      },
      {
        companyCode: 'ISP',
        companyName: 'Indra Service Park',
        shortName: 'Service Park',
        count: 100,
        valueLkr: 11_750_000,
      },
    ],
    assetsByStatus: [
      { status: 'available', label: 'Available', count: 64 },
      { status: 'deployed', label: 'Assigned', count: 301 },
      { status: 'under_repair', label: 'Maintenance', count: 28 },
      { status: 'disposed', label: 'Retired', count: 19 },
    ],
    assetsByType: [
      { category: 'laptop', label: 'Laptops', count: 168 },
      { category: 'pc', label: 'Desktop PCs', count: 112 },
      { category: 'mobile_phone', label: 'Mobile Phones', count: 84 },
      { category: 'other', label: 'Other assets', count: 48 },
    ],
    upcomingWarranties: [
      {
        id: 1,
        assetTag: 'IT-LP-0142',
        pcName: 'IT-KDY-ACC-12',
        company: 'Traders',
        category: 'laptop',
        warrantyExpiresOn: '2026-09-22',
        daysRemaining: 14,
      },
      {
        id: 2,
        assetTag: 'IMS-PC-0088',
        pcName: 'IMS-CMB-SALES-03',
        company: 'Motor Spares',
        category: 'pc',
        warrantyExpiresOn: '2026-10-05',
        daysRemaining: 27,
      },
      {
        id: 3,
        assetTag: 'ISP-MB-0031',
        pcName: null,
        company: 'Service Park',
        category: 'mobile_phone',
        warrantyExpiresOn: '2026-10-28',
        daysRemaining: 50,
      },
    ],
    recentActivity: [
      {
        id: '1',
        title: 'Laptop assigned',
        description: 'IT-LP-0142 issued to Accounts',
        user: 'Central IT',
        time: '2h ago',
        tone: 'success',
      },
      {
        id: '2',
        title: 'PC hardware replaced',
        description: 'IMS-PC-0088 SSD upgraded',
        user: 'IT Admin',
        time: '4h ago',
        tone: 'primary',
      },
      {
        id: '3',
        title: 'Asset returned',
        description: 'Mobile phone checked in',
        user: 'IT Staff',
        time: 'Yesterday',
        tone: 'primary',
      },
    ],
    warrantyDays: 90,
  };
}

export function formatLkr(amount: number): string {
  return new Intl.NumberFormat('en-LK', {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 0,
  }).format(amount);
}
