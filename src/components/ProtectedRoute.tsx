import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

// '/payment-sheets' is deliberately absent — site raises its own sheets there.
// Only the procurement-facing surfaces are employee-blocked.
const adminOnlyRoutes = ['/rfqs', '/quotes', '/comparison', '/purchase-orders', '/suppliers', '/audit', '/invoices', '/kanban', '/analytics', '/schedule', '/tasks', '/payment-requests', '/backfill-report', '/exception-board'];

// The project coordinator is not part of procurement — it gets an allowlist rather
// than a blocklist, because everything outside its own surface is off-limits.
const coordinatorRoutes = ['/dashboard', '/schedule', '/tasks', '/my-work', '/stock', '/stock-overview', '/requisitions'];

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  const isEmployee = user.role === 'requestor' || user.role === 'site_receiver';
  if (isEmployee && adminOnlyRoutes.some(r => location.pathname.startsWith(r))) {
    return <Navigate to="/dashboard" replace />;
  }
  if (user.role === 'project_coordinator' && !coordinatorRoutes.some(r => location.pathname.startsWith(r))) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
};
