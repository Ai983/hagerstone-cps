import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  MessageCircle,
  Package,
  ShoppingCart,
  Star,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

/**
 * ItemVendorExplorer — a single dialog with breadcrumb navigation that lets a
 * procurement person source vendors from existing history instead of searching
 * the web blindly. Drill-down: item -> vendors -> vendor detail + PO history -> PO summary.
 *
 * Data sources (all read-only):
 *  - cps_supplier_items : exact item<->supplier link with rate intelligence
 *  - cps_items          : category fallback (other items in the same category)
 *  - cps_suppliers      : vendor profile
 *  - cps_purchase_orders / cps_po_line_items : PO history + read-only PO summary
 */

export type ExplorerItem = {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
};

type VendorRow = {
  supplier_id: string;
  name: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  whatsapp: string | null;
  // exact-item intel (null for category-only vendors)
  best_rate?: number | null;
  last_quoted_rate?: number | null;
  quote_count?: number | null;
  last_quoted_date?: string | null;
  is_preferred?: boolean | null;
  rate_trend?: string | null;
  // category fallback
  category_item_count?: number;
};

type SupplierDetail = {
  id: string;
  name: string;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  city: string | null;
  state: string | null;
  categories: string[] | null;
  performance_score: number | null;
  win_rate: number | null;
  bank_name: string | null;
  bank_account_holder_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
};

type SupplierPO = {
  id: string;
  po_number: string;
  status: string;
  grand_total: number | null;
  created_at: string | null;
  delivery_date: string | null;
  project_code: string | null;
};

type PoHeader = {
  id: string;
  po_number: string;
  status: string;
  project_code: string | null;
  ship_to_address: string | null;
  created_at: string | null;
  delivery_date: string | null;
  payment_terms: string | null;
  total_value: number | null;
  gst_amount: number | null;
  grand_total: number | null;
  supplier_name_text: string | null;
};

type PoLine = {
  id: string;
  description: string | null;
  brand: string | null;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  gst_percent: number | null;
  total_value: number | null;
  hsn_code: string | null;
};

const formatINR = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return `₹${n.toLocaleString("en-IN")}`;
};

const formatDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

const waLink = (v: VendorRow | SupplierDetail) => {
  const num = (v.whatsapp || v.phone || "").replace(/\D/g, "");
  return num ? `https://wa.me/${num}` : null;
};

const statusBadgeClass = (status: string) =>
  status === "approved" || status === "sent"
    ? "bg-green-100 text-green-800"
    : status === "draft"
      ? "bg-muted text-muted-foreground"
      : status === "delivered" || status === "closed"
        ? "bg-emerald-100 text-emerald-800"
        : status === "cancelled" || status === "rejected"
          ? "bg-red-100 text-red-800"
          : "bg-blue-100 text-blue-800";

type View = "vendors" | "vendor" | "po";

export default function ItemVendorExplorer({ item, onClose }: { item: ExplorerItem | null; onClose: () => void }) {
  const [view, setView] = useState<View>("vendors");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [selectedSupplierName, setSelectedSupplierName] = useState<string>("");
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);

  // View 1 — vendors for the item
  const [exactVendors, setExactVendors] = useState<VendorRow[]>([]);
  const [categoryVendors, setCategoryVendors] = useState<VendorRow[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);

  // View 2 — vendor detail + PO history
  const [supplier, setSupplier] = useState<SupplierDetail | null>(null);
  const [supplierPOs, setSupplierPOs] = useState<SupplierPO[]>([]);
  const [vendorLoading, setVendorLoading] = useState(false);

  // View 3 — PO read-only summary
  const [poHeader, setPoHeader] = useState<PoHeader | null>(null);
  const [poLines, setPoLines] = useState<PoLine[]>([]);
  const [poLoading, setPoLoading] = useState(false);

  // Reset navigation to the top of the stack whenever a new item is opened.
  useEffect(() => {
    if (!item) return;
    setView("vendors");
    setSelectedSupplierId(null);
    setSelectedPoId(null);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // View 1 data — load vendors for the item (exact + category fallback)
  useEffect(() => {
    if (!item || view !== "vendors") return;
    let cancelled = false;
    (async () => {
      setVendorsLoading(true);
      setExactVendors([]);
      setCategoryVendors([]);

      // --- Exact item vendors (cps_supplier_items) ---
      const { data: siRows } = await supabase
        .from("cps_supplier_items")
        .select("supplier_id, last_quoted_rate, best_rate, quote_count, last_quoted_date, is_preferred, rate_trend")
        .eq("item_id", item.id);

      const exactIds = Array.from(new Set((siRows ?? []).map((r: any) => r.supplier_id).filter(Boolean)));

      // --- Category fallback: other items in the same category -> their suppliers ---
      let categoryCounts = new Map<string, number>();
      if (item.category) {
        const { data: catItems } = await supabase
          .from("cps_items")
          .select("id")
          .eq("category", item.category)
          .neq("id", item.id);
        const catItemIds = (catItems ?? []).map((r: any) => r.id);
        if (catItemIds.length > 0) {
          const { data: catSi } = await supabase
            .from("cps_supplier_items")
            .select("supplier_id, item_id")
            .in("item_id", catItemIds);
          (catSi ?? []).forEach((r: any) => {
            if (!r.supplier_id || exactIds.includes(r.supplier_id)) return;
            categoryCounts.set(r.supplier_id, (categoryCounts.get(r.supplier_id) ?? 0) + 1);
          });
        }
      }

      const allSupplierIds = Array.from(new Set([...exactIds, ...categoryCounts.keys()]));
      if (allSupplierIds.length === 0) {
        if (!cancelled) {
          setVendorsLoading(false);
        }
        return;
      }

      const { data: suppliers } = await supabase
        .from("cps_suppliers")
        .select("id, name, city, state, phone, whatsapp")
        .in("id", allSupplierIds);
      const supplierMap = new Map<string, any>((suppliers ?? []).map((s: any) => [s.id, s]));

      const exact: VendorRow[] = (siRows ?? [])
        .filter((r: any) => supplierMap.has(r.supplier_id))
        .map((r: any) => {
          const s = supplierMap.get(r.supplier_id);
          return {
            supplier_id: r.supplier_id,
            name: s.name,
            city: s.city,
            state: s.state,
            phone: s.phone,
            whatsapp: s.whatsapp,
            best_rate: r.best_rate,
            last_quoted_rate: r.last_quoted_rate,
            quote_count: r.quote_count,
            last_quoted_date: r.last_quoted_date,
            is_preferred: r.is_preferred,
            rate_trend: r.rate_trend,
          };
        })
        .sort((a: VendorRow, b: VendorRow) => {
          const ar = a.best_rate ?? a.last_quoted_rate ?? Number.POSITIVE_INFINITY;
          const br = b.best_rate ?? b.last_quoted_rate ?? Number.POSITIVE_INFINITY;
          if (ar !== br) return ar - br;
          return (b.quote_count ?? 0) - (a.quote_count ?? 0);
        });

      const category: VendorRow[] = Array.from(categoryCounts.entries())
        .filter(([id]) => supplierMap.has(id))
        .map(([id, count]) => {
          const s = supplierMap.get(id);
          return {
            supplier_id: id,
            name: s.name,
            city: s.city,
            state: s.state,
            phone: s.phone,
            whatsapp: s.whatsapp,
            category_item_count: count,
          };
        })
        .sort((a, b) => (b.category_item_count ?? 0) - (a.category_item_count ?? 0));

      if (!cancelled) {
        setExactVendors(exact);
        setCategoryVendors(category);
        setVendorsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item?.id, item?.category, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // View 2 data — vendor detail + PO history
  useEffect(() => {
    if (view !== "vendor" || !selectedSupplierId) return;
    let cancelled = false;
    (async () => {
      setVendorLoading(true);
      setSupplier(null);
      setSupplierPOs([]);
      const [{ data: s }, { data: pos }] = await Promise.all([
        supabase
          .from("cps_suppliers")
          .select(
            "id,name,gstin,email,phone,whatsapp,city,state,categories,performance_score,win_rate,bank_name,bank_account_holder_name,bank_account_number,bank_ifsc",
          )
          .eq("id", selectedSupplierId)
          .maybeSingle(),
        supabase
          .from("cps_purchase_orders")
          .select("id,po_number,status,grand_total,created_at,delivery_date,project_code")
          .eq("supplier_id", selectedSupplierId)
          .order("created_at", { ascending: false }),
      ]);
      if (!cancelled) {
        setSupplier((s as SupplierDetail) ?? null);
        setSupplierPOs((pos ?? []) as SupplierPO[]);
        setVendorLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, selectedSupplierId]);

  // View 3 data — PO read-only summary
  useEffect(() => {
    if (view !== "po" || !selectedPoId) return;
    let cancelled = false;
    (async () => {
      setPoLoading(true);
      setPoHeader(null);
      setPoLines([]);
      const [{ data: header }, { data: lines }] = await Promise.all([
        supabase
          .from("cps_purchase_orders")
          .select(
            "id,po_number,status,project_code,ship_to_address,created_at,delivery_date,payment_terms,total_value,gst_amount,grand_total,supplier_name_text",
          )
          .eq("id", selectedPoId)
          .maybeSingle(),
        supabase
          .from("cps_po_line_items")
          .select("id,description,brand,quantity,unit,rate,gst_percent,total_value,hsn_code,sort_order")
          .eq("po_id", selectedPoId)
          .order("sort_order", { ascending: true }),
      ]);
      if (!cancelled) {
        setPoHeader((header as PoHeader) ?? null);
        setPoLines((lines ?? []) as PoLine[]);
        setPoLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, selectedPoId]);

  const goVendor = (v: VendorRow) => {
    setSelectedSupplierId(v.supplier_id);
    setSelectedSupplierName(v.name);
    setView("vendor");
  };

  const goPo = (poId: string) => {
    setSelectedPoId(poId);
    setView("po");
  };

  const back = () => {
    if (view === "po") setView("vendor");
    else if (view === "vendor") setView("vendors");
  };

  const renderTrend = (trend: string | null | undefined) => {
    if (!trend) return null;
    const t = trend.toLowerCase();
    if (t === "up" || t === "increasing") return <TrendingUp className="h-3.5 w-3.5 text-red-500" aria-label="rate rising" />;
    if (t === "down" || t === "decreasing") return <TrendingDown className="h-3.5 w-3.5 text-green-600" aria-label="rate falling" />;
    return null;
  };

  const renderVendorRow = (v: VendorRow, showRates: boolean) => {
    const wa = waLink(v);
    return (
      <TableRow key={v.supplier_id} className="cursor-pointer hover:bg-muted/40" onClick={() => goVendor(v)}>
        <TableCell>
          <div className="flex items-center gap-2">
            <span className="font-medium">{v.name}</span>
            {v.is_preferred && (
              <Badge className="bg-amber-100 text-amber-800 border-0 text-[10px]">
                <Star className="h-3 w-3 mr-0.5 fill-amber-500 text-amber-500" />
                preferred
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{[v.city, v.state].filter(Boolean).join(", ") || "—"}</div>
        </TableCell>
        {showRates ? (
          <>
            <TableCell className="text-right text-sm">
              <div className="flex items-center justify-end gap-1">
                {formatINR(v.best_rate ?? v.last_quoted_rate)}
                {renderTrend(v.rate_trend)}
              </div>
            </TableCell>
            <TableCell className="text-center text-sm text-muted-foreground">{v.quote_count ?? "—"}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDate(v.last_quoted_date)}</TableCell>
          </>
        ) : (
          <TableCell className="text-center text-sm text-muted-foreground">
            <Badge variant="outline" className="text-xs">{v.category_item_count} items</Badge>
          </TableCell>
        )}
        <TableCell className="text-right">
          {wa ? (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center text-green-600 hover:text-green-700"
              aria-label={`WhatsApp ${v.name}`}
            >
              <MessageCircle className="h-4 w-4" />
            </a>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          )}
        </TableCell>
        <TableCell className="w-6">
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </TableCell>
      </TableRow>
    );
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl max-h-[88vh] overflow-y-auto">
        {/* Breadcrumb header */}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {view !== "vendors" && (
              <Button variant="ghost" size="sm" className="h-7 px-2 -ml-2" onClick={back}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {view === "vendors" && <Package className="h-5 w-5 text-primary" />}
            {view === "vendor" && <Building2 className="h-5 w-5 text-primary" />}
            {view === "po" && <ShoppingCart className="h-5 w-5 text-primary" />}
            <span className="truncate">
              {view === "vendors" && item?.name}
              {view === "vendor" && (supplier?.name ?? selectedSupplierName)}
              {view === "po" && (poHeader?.po_number ?? "Purchase Order")}
            </span>
          </DialogTitle>
          <DialogDescription>
            {view === "vendors" && `Vendors who deal in this item${item?.category ? ` · ${item.category}` : ""}`}
            {view === "vendor" && (
              <span>
                <button type="button" className="hover:underline" onClick={() => setView("vendors")}>{item?.name}</button>
                <span className="mx-1">›</span>Vendor profile & PO history
              </span>
            )}
            {view === "po" && (
              <span>
                <button type="button" className="hover:underline" onClick={() => setView("vendors")}>{item?.name}</button>
                <span className="mx-1">›</span>
                <button type="button" className="hover:underline" onClick={() => setView("vendor")}>{supplier?.name ?? selectedSupplierName}</button>
                <span className="mx-1">›</span>PO details
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* ---------- VIEW 1: VENDORS ---------- */}
        {view === "vendors" && (
          <div className="space-y-5">
            {vendorsLoading ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : exactVendors.length === 0 && categoryVendors.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                No vendor history for this item yet.
                <div className="mt-1 text-xs">Try the Suppliers page to add or search vendors.</div>
              </div>
            ) : (
              <>
                {exactVendors.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-sm font-semibold">Quoted this exact item</h3>
                      <Badge variant="outline" className="text-xs">{exactVendors.length}</Badge>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Vendor</TableHead>
                          <TableHead className="text-right">Best rate</TableHead>
                          <TableHead className="text-center">Quotes</TableHead>
                          <TableHead>Last quoted</TableHead>
                          <TableHead className="text-right">Chat</TableHead>
                          <TableHead className="w-6" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>{exactVendors.map((v) => renderVendorRow(v, true))}</TableBody>
                    </Table>
                  </div>
                )}

                {categoryVendors.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-sm font-semibold">Also deal in {item?.category ?? "this category"}</h3>
                      <Badge variant="outline" className="text-xs">{categoryVendors.length}</Badge>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Vendor</TableHead>
                          <TableHead className="text-center">Category items</TableHead>
                          <TableHead className="text-right">Chat</TableHead>
                          <TableHead className="w-6" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>{categoryVendors.map((v) => renderVendorRow(v, false))}</TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ---------- VIEW 2: VENDOR DETAIL ---------- */}
        {view === "vendor" && (
          <div className="space-y-4">
            {vendorLoading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : !supplier ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Vendor not found.</div>
            ) : (
              <>
                {/* Profile */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">GSTIN: </span><span className="font-mono font-medium">{supplier.gstin ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">Location: </span><span>{[supplier.city, supplier.state].filter(Boolean).join(", ") || "—"}</span></div>
                  <div>
                    <span className="text-muted-foreground">Phone: </span>
                    {waLink(supplier) ? (
                      <a href={waLink(supplier)!} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:underline inline-flex items-center gap-1">
                        <MessageCircle className="h-3.5 w-3.5" />{supplier.whatsapp || supplier.phone}
                      </a>
                    ) : (
                      <span>{supplier.phone ?? "—"}</span>
                    )}
                  </div>
                  <div><span className="text-muted-foreground">Email: </span><span>{supplier.email ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">Performance: </span><span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />{supplier.performance_score ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">Win rate: </span><span>{supplier.win_rate != null ? `${supplier.win_rate}%` : "—"}</span></div>
                  {supplier.categories && supplier.categories.length > 0 && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Categories: </span>
                      <span className="inline-flex gap-1 flex-wrap mt-1">
                        {supplier.categories.map((c) => <Badge key={c} variant="outline" className="text-xs">{c}</Badge>)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Bank details */}
                <div className="border-t pt-3 grid grid-cols-2 gap-3 text-sm">
                  <div className="col-span-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bank details</div>
                  {supplier.bank_account_number ? (
                    <>
                      <div><span className="text-muted-foreground">Bank: </span><span>{supplier.bank_name ?? "—"}</span></div>
                      <div><span className="text-muted-foreground">Holder: </span><span>{supplier.bank_account_holder_name ?? "—"}</span></div>
                      <div><span className="text-muted-foreground">A/C: </span><span className="font-mono">{supplier.bank_account_number}</span></div>
                      <div><span className="text-muted-foreground">IFSC: </span><span className="font-mono">{supplier.bank_ifsc ?? "—"}</span></div>
                    </>
                  ) : (
                    <div className="col-span-2 text-xs text-muted-foreground">No bank details saved.</div>
                  )}
                </div>

                {/* PO history */}
                <div className="border-t pt-3">
                  <div className="flex items-center gap-2 mb-3">
                    <ShoppingCart className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Purchase Order History</h3>
                    <Badge variant="outline" className="text-xs">{supplierPOs.length} POs</Badge>
                  </div>
                  {supplierPOs.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm">No purchase orders with this vendor yet.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>PO Number</TableHead>
                          <TableHead>Site</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="w-6" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {supplierPOs.map((po) => (
                          <TableRow key={po.id} className="cursor-pointer hover:bg-muted/40" onClick={() => goPo(po.id)}>
                            <TableCell className="font-mono text-primary text-xs">{po.po_number}</TableCell>
                            <TableCell className="text-sm">{po.project_code ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{formatDate(po.created_at)}</TableCell>
                            <TableCell><Badge className={`text-[10px] border-0 ${statusBadgeClass(po.status)}`}>{po.status}</Badge></TableCell>
                            <TableCell className="text-right text-sm">{formatINR(po.grand_total)}</TableCell>
                            <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ---------- VIEW 3: PO SUMMARY (read-only) ---------- */}
        {view === "po" && (
          <div className="space-y-4">
            {poLoading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : !poHeader ? (
              <div className="text-center py-8 text-muted-foreground text-sm">PO not found.</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">PO Number: </span><span className="font-mono font-medium">{poHeader.po_number}</span></div>
                  <div><span className="text-muted-foreground">Status: </span><Badge className={`text-[10px] border-0 ${statusBadgeClass(poHeader.status)}`}>{poHeader.status}</Badge></div>
                  <div><span className="text-muted-foreground">Site: </span><span>{poHeader.project_code ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">PO Date: </span><span>{formatDate(poHeader.created_at)}</span></div>
                  <div><span className="text-muted-foreground">Delivery: </span><span>{formatDate(poHeader.delivery_date)}</span></div>
                  <div><span className="text-muted-foreground">Payment terms: </span><span>{poHeader.payment_terms ?? "—"}</span></div>
                  {poHeader.ship_to_address && (
                    <div className="col-span-2"><span className="text-muted-foreground">Ship to: </span><span>{poHeader.ship_to_address}</span></div>
                  )}
                </div>

                <div className="border-t pt-3">
                  <h3 className="text-sm font-semibold mb-2">Line Items</h3>
                  {poLines.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm">No line items.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Description</TableHead>
                          <TableHead>Brand</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">GST%</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {poLines.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell className="text-sm">{l.description ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{l.brand ?? "—"}</TableCell>
                            <TableCell className="text-right text-sm">{l.quantity ?? "—"}{l.unit ? ` ${l.unit}` : ""}</TableCell>
                            <TableCell className="text-right text-sm">{formatINR(l.rate)}</TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">{l.gst_percent ?? "—"}</TableCell>
                            <TableCell className="text-right text-sm">{formatINR(l.total_value)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {/* Totals */}
                <div className="border-t pt-3 flex flex-col items-end gap-1 text-sm">
                  <div><span className="text-muted-foreground mr-2">Subtotal:</span>{formatINR(poHeader.total_value)}</div>
                  <div><span className="text-muted-foreground mr-2">GST:</span>{formatINR(poHeader.gst_amount)}</div>
                  <div className="font-bold text-base"><span className="text-muted-foreground mr-2 font-normal text-sm">Grand Total:</span>{formatINR(poHeader.grand_total)}</div>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
