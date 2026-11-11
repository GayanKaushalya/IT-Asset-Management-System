import { Navigate } from 'react-router-dom';
import PlaceholderPage from './PlaceholderPage';

export { default as AccessLogsPage } from './AccessLogsPage';
export { default as AuditLogsPage } from './AuditLogsPage';

export { default as AssetReportsPage } from './AssetReportsPage';
export { default as InventoryReportsPage } from './InventoryReportsPage';
export { default as MaintenanceReportsPage } from './MaintenanceReportsPage';
export { default as BranchAssetReportPage } from './BranchAssetReportPage';
export { default as StockReportPage } from './StockReportPage';

export function CredentialReportsPage() {
  return <PlaceholderPage title="Credential Reports" description="Vault coverage and credential hygiene reports." />;
}

export function LegacyCredentialsRedirect() {
  return <Navigate to="/credentials/emails" replace />;
}
