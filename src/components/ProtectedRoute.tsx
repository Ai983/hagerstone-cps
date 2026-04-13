import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const adminOnlyRoutes = ['/rfqs', '/quotes', '/comparison', '/purchase-orders', '/suppliers', '/audit', '/invoices', '/kanban', '/analytics'];

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  const isEmployee = user.role === 'requestor' || user.role === 'site_receiver';
  if (isEmployee && adminOnlyRoutes.some(r => location.pathname.startsWith(r))) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
};
