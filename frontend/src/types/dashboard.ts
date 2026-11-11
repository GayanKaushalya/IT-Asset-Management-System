export type SubCompanyCode = 'IT' | 'IMS' | 'ISP' | 'FOTON' | string;

export type AssetStatus = 'available' | 'deployed' | 'under_repair' | 'lost' | 'disposed';

export interface DashboardStats {
  totalAssets: number;
  totalValueLkr: number;
  totalUsers?: number;
  totalLocations?: number;
  totalSuppliers?: number;
  totalCredentials?: number;
  assignedAssets?: number;
  availableAssets?: number;
  maintenanceAssets?: number;
  lostAssets?: number;
  totalLaptops?: number;
  totalMobilePhones?: number;
  totalPcs?: number;
  totalOtherAssets?: number;
  warrantyDueCount?: number;
}

export interface AssetsByCompanyPoint {
  companyCode: SubCompanyCode;
  companyName: string;
  shortName: string;
  count: number;
  valueLkr: number;
}

export interface AssetsByStatusPoint {
  status: AssetStatus;
  label: string;
  count: number;
}

export interface AssetsByTypePoint {
  category: string;
  label: string;
  count: number;
}

export interface WarrantyExpiryItem {
  id: number;
  assetTag: string;
  pcName: string | null;
  company: string;
  category: string;
  warrantyExpiresOn: string;
  daysRemaining: number;
}

export interface ActivityItemDto {
  id: string;
  title: string;
  description?: string;
  user?: string;
  time: string;
  tone?: 'primary' | 'security' | 'success' | 'warning';
}

export interface DashboardPayload {
  stats: DashboardStats;
  assetsByCompany: AssetsByCompanyPoint[];
  assetsByStatus: AssetsByStatusPoint[];
  assetsByType?: AssetsByTypePoint[];
  upcomingWarranties: WarrantyExpiryItem[];
  recentActivity?: ActivityItemDto[];
  warrantyDays?: number;
}
