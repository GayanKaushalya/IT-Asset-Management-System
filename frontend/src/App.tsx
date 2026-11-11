import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import AppLayout from './components/AppLayout';
import DateInputMinGuard from './components/DateInputMinGuard';
import { ToastProvider } from './components/ui/Toast';
import AssetsPage from './pages/Assets';
import CredentialsPage from './pages/Credentials';
import DashboardPage from './pages/Dashboard';
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import {
  AssetReportsPage,
  InventoryReportsPage,
  MaintenanceReportsPage,
  BranchAssetReportPage,
  StockReportPage,
} from './pages/SystemPages';
import SettingsPage from './pages/SettingsPage';
import HandoverReportsPage from './pages/HandoverReportsPage';
import OrganizationPage from './pages/OrganizationPage';
import AgreementsPage from './pages/AgreementsPage';
import ExpenditurePage from './pages/ExpenditurePage';
import ExpenditureReportPage from './pages/ExpenditureReportPage';
import type { ReactNode } from 'react';

function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <DateInputMinGuard />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/"
            element={
              <Protected>
                <AppLayout />
              </Protected>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="organization" element={<Navigate to="/organization/employees" replace />} />
            <Route path="organization/:section" element={<OrganizationPage />} />

            <Route path="assets" element={<Navigate to="/assets/all" replace />} />
            <Route path="assets/pc" element={<Navigate to="/assets/all" replace />} />
            <Route path="assets/:category" element={<AssetsPage />} />
            <Route path="agreements" element={<AgreementsPage />} />
            <Route path="expenditures" element={<ExpenditurePage />} />
            <Route path="peripherals" element={<Navigate to="/assets/others" replace />} />

            <Route path="credentials" element={<Navigate to="/credentials/emails" replace />} />
            <Route path="credentials/access-logs" element={<Navigate to="/credentials/emails" replace />} />
            <Route path="credentials/:section" element={<CredentialsPage />} />

            <Route path="reports/assets" element={<AssetReportsPage />} />
            <Route path="reports/assets/inventory" element={<InventoryReportsPage />} />
            <Route path="reports/assets/employees" element={<Navigate to="/reports/assets" replace />} />
            <Route path="reports/handovers" element={<HandoverReportsPage />} />
            <Route path="reports/expenditure" element={<ExpenditureReportPage />} />
            <Route path="reports/maintenance" element={<MaintenanceReportsPage />} />
            <Route path="reports/branches" element={<BranchAssetReportPage />} />
            <Route path="reports/stock" element={<StockReportPage />} />
            <Route path="reports/credentials" element={<Navigate to="/reports/assets" replace />} />

            <Route path="settings" element={<Navigate to="/settings/account" replace />} />
            <Route path="settings/:section" element={<SettingsPage />} />
            <Route path="audit-logs" element={<Navigate to="/settings" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
