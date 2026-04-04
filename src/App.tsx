import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Layout } from "@/components/layout/Layout";

const Login = React.lazy(() => import("@/pages/Login"));
const Dashboard = React.lazy(() => import("@/pages/Dashboard"));
const PurchaseRequisitions = React.lazy(() => import("@/pages/PurchaseRequisitions"));
const SupplierMaster = React.lazy(() => import("@/pages/SupplierMaster"));
const ItemMaster = React.lazy(() => import("@/pages/ItemMaster"));
const RFQs = React.lazy(() => import("@/pages/RFQs"));
const Quotes = React.lazy(() => import("@/pages/Quotes"));
const ComparisonSheet = React.lazy(() => import("@/pages/ComparisonSheet"));
const PurchaseOrders = React.lazy(() => import("@/pages/PurchaseOrders"));
const DeliveryTracker = React.lazy(() => import("@/pages/DeliveryTracker"));
const AuditLog = React.lazy(() => import("@/pages/AuditLog"));
const VendorRegister = React.lazy(() => import("@/pages/VendorRegister"));
const VendorStatus = React.lazy(() => import("@/pages/VendorStatus"));
const VendorUploadQuote = React.lazy(() => import("@/pages/VendorUploadQuote"));
const InvoiceUpload = React.lazy(() => import("@/pages/InvoiceUpload"));
const ApprovePoPage = React.lazy(() => import("@/pages/ApprovePoPage"));

const Loader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
  </div>
);

const queryClient = new QueryClient();

function Protected({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute><Layout>{children}</Layout></ProtectedRoute>;
}

const App = () => (
  <AuthProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
          <React.Suspense fallback={<Loader />}>
            <Routes>
              <Route path="/vendor/register" element={<VendorRegister />} />
              <Route path="/vendor/status" element={<VendorStatus />} />
              <Route path="/vendor/upload-quote" element={<VendorUploadQuote />} />
              <Route path="/approve-po" element={<ApprovePoPage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
              <Route path="/suppliers" element={<Protected><SupplierMaster /></Protected>} />
              <Route path="/items" element={<Protected><ItemMaster /></Protected>} />
              <Route path="/requisitions" element={<Protected><PurchaseRequisitions /></Protected>} />
              <Route path="/rfqs" element={<Protected><RFQs /></Protected>} />
              <Route path="/quotes" element={<Protected><Quotes /></Protected>} />
              <Route path="/comparison/:rfqId" element={<Protected><ComparisonSheet /></Protected>} />
              <Route path="/comparison" element={
                <Protected>
                  <div className="flex items-center justify-center h-64">
                    <p className="text-muted-foreground">Select an RFQ to view its comparison sheet</p>
                  </div>
                </Protected>
              } />
              <Route path="/purchase-orders" element={<Protected><PurchaseOrders /></Protected>} />
              <Route path="/delivery" element={<Protected><DeliveryTracker /></Protected>} />
              <Route path="/audit" element={<Protected><AuditLog /></Protected>} />
              <Route path="/invoices/upload" element={<Protected><InvoiceUpload /></Protected>} />
              <Route path="*" element={<Protected><div className="p-8 text-center"><h1 className="text-2xl font-bold">404 — Page not found</h1></div></Protected>} />
            </Routes>
          </React.Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </AuthProvider>
);

export default App;
