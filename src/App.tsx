import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Layout } from "@/components/layout/Layout";

/**
 * Wraps React.lazy with a stale-chunk handler.
 * When Vercel redeploys, old JS chunks 404. The cached HTML still
 * references those old chunk names, so React.lazy import fails with
 * "Failed to fetch dynamically imported module". This handler detects
 * the chunk failure and triggers a one-time hard reload, which pulls
 * the fresh index.html referencing the new chunks.
 *
 * sessionStorage guards against infinite reload loops — if reload
 * still fails, we surface the real error instead of looping.
 */
const lazyWithRetry = <T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> =>
  React.lazy(async () => {
    const reloadKey = "cps_chunk_reload_attempted";
    try {
      const mod = await factory();
      // success — clear any prior reload flag
      sessionStorage.removeItem(reloadKey);
      return mod;
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? "");
      const isChunkError =
        /Failed to fetch dynamically imported module/i.test(msg) ||
        /Importing a module script failed/i.test(msg) ||
        /ChunkLoadError/i.test(msg) ||
        /Loading chunk/i.test(msg);

      const alreadyReloaded = sessionStorage.getItem(reloadKey) === "1";
      if (isChunkError && !alreadyReloaded) {
        sessionStorage.setItem(reloadKey, "1");
        window.location.reload();
        // return a never-resolving promise so Suspense keeps the loader
        // showing until the reload takes effect
        return new Promise(() => {}) as Promise<{ default: T }>;
      }
      throw err;
    }
  });

const Login = lazyWithRetry(() => import("@/pages/Login"));
const Dashboard = lazyWithRetry(() => import("@/pages/Dashboard"));
const PurchaseRequisitions = lazyWithRetry(() => import("@/pages/PurchaseRequisitions"));
const SupplierMaster = lazyWithRetry(() => import("@/pages/SupplierMaster"));
const ItemMaster = lazyWithRetry(() => import("@/pages/ItemMaster"));
const RFQs = lazyWithRetry(() => import("@/pages/RFQs"));
const Quotes = lazyWithRetry(() => import("@/pages/Quotes"));
const ComparisonSheet = lazyWithRetry(() => import("@/pages/ComparisonSheet"));
const PurchaseOrders = lazyWithRetry(() => import("@/pages/PurchaseOrders"));
const DeliveryTracker = lazyWithRetry(() => import("@/pages/DeliveryTracker"));
const AuditLog = lazyWithRetry(() => import("@/pages/AuditLog"));
const VendorRegister = lazyWithRetry(() => import("@/pages/VendorRegister"));
const VendorStatus = lazyWithRetry(() => import("@/pages/VendorStatus"));
const VendorUploadQuote = lazyWithRetry(() => import("@/pages/VendorUploadQuote"));
const InvoiceUpload = lazyWithRetry(() => import("@/pages/InvoiceUpload"));
const ApprovePoPage = lazyWithRetry(() => import("@/pages/ApprovePoPage"));
const PRReview = lazyWithRetry(() => import("@/pages/PRReview"));
const KanbanBoard = lazyWithRetry(() => import("@/pages/KanbanBoard"));
const Analytics = lazyWithRetry(() => import("@/pages/Analytics"));
const SiteStock = lazyWithRetry(() => import("@/pages/SiteStock"));
const SiteQuotes = lazyWithRetry(() => import("@/pages/SiteQuotes"));
const ProjectBOQ = lazyWithRetry(() => import("@/pages/ProjectBOQ"));
const StockOverview = lazyWithRetry(() => import("@/pages/StockOverview"));
const NotFound = lazyWithRetry(() => import("@/pages/NotFound"));

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
              <Route path="/pr-review" element={<Protected><PRReview /></Protected>} />
              <Route path="/kanban" element={<Protected><KanbanBoard /></Protected>} />
              <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
              <Route path="/stock" element={<Protected><SiteStock /></Protected>} />
              <Route path="/site-quotes" element={<Protected><SiteQuotes /></Protected>} />
              <Route path="/boq" element={<Protected><ProjectBOQ /></Protected>} />
              <Route path="/stock-overview" element={<Protected><StockOverview /></Protected>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </React.Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </AuthProvider>
);

export default App;
