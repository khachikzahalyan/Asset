import { Routes, Route, Navigate } from 'react-router-dom';

import LoginPage from '@/pages/LoginPage.jsx';
import EmployeeLinkRequestPage from '@/pages/EmployeeLinkRequestPage.jsx';
import EmailLinkLandingPage from '@/pages/EmailLinkLandingPage.jsx';
import DashboardPage from '@/pages/DashboardPage.jsx';
import EmployeeSelfServicePage from '@/pages/EmployeeSelfServicePage.jsx';
import ForbiddenPage from '@/pages/ForbiddenPage.jsx';
import NotFoundPage from '@/pages/NotFoundPage.jsx';
import BranchListPage from '@/pages/BranchListPage.jsx';
import BranchDetailPage from '@/pages/BranchDetailPage.jsx';
import UsersPage from '@/pages/UsersPage.jsx';

import AppShell from '@/components/layout/AppShell.jsx';
import RequireAuth from '@/components/auth/RequireAuth.jsx';
import RoleGate from '@/components/auth/RoleGate.jsx';
import { ROLES, ADMIN_ROLES } from '@/domain/roles.js';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/employee" element={<EmployeeLinkRequestPage />} />
      <Route path="/auth/email-link" element={<EmailLinkLandingPage />} />
      <Route path="/403" element={<ForbiddenPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route
          path="/dashboard"
          element={
            <RoleGate roles={ADMIN_ROLES}>
              <DashboardPage />
            </RoleGate>
          }
        />
        <Route
          path="/branches"
          element={
            <RoleGate roles={[ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN]}>
              <BranchListPage />
            </RoleGate>
          }
        />
        <Route
          path="/branches/:id"
          element={
            <RoleGate roles={[ROLES.SUPER_ADMIN, ROLES.ASSET_ADMIN]}>
              <BranchDetailPage />
            </RoleGate>
          }
        />
        <Route
          path="/me"
          element={
            <RoleGate roles={[ROLES.EMPLOYEE]}>
              <EmployeeSelfServicePage />
            </RoleGate>
          }
        />
        <Route
          path="/users"
          element={
            <RoleGate roles={[ROLES.SUPER_ADMIN]}>
              <UsersPage />
            </RoleGate>
          }
        />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
