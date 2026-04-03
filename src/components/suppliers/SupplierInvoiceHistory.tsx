import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, FileText, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type LineRow = {
  id: string;
  original_description: string | null;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  tax_percent: number | null;
  taxable_value: number | null;
  hsn_sac: string | null;
  line_total: number | null;
  item_type: string | null;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  invoice_date: string | null;
  total_amount: number | null;
  document_type: string | null;
  source_file: string | null;
  extraction_confidence: number | null;
  needs_review: boolean | null;
  invoice_line_items: LineRow[] | null;
};

const statusBadgeClass = (status: string) => {
  if (status === "active") return "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300 border-0";
  if (status === "blacklisted") return "bg-destructive/15 text-destructive border-0";
  return "bg-muted text-muted-foreground border-0";
};

function formatMoney(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n));
}

interface SupplierInvoiceHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierName: string;
  gstin: string | null;
  status: string;
  totalPoValue: number | null;
  vendorId: string | null;
}

export function SupplierInvoiceHistory({
  open,
  onOpenChange,
  supplierName,
  gstin,
  status,
  totalPoValue,
  vendorId,
}: SupplierInvoiceHistoryProps) {
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchInvoices = useCallback(async () => {
    if (!vendorId) {
      setInvoices([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("invoices")
      .select(
        `
        id,
        invoice_number,
        invoice_date,
        total_amount,
        document_type,
        source_file,
        extraction_confidence,
        needs_review,
        invoice_line_items (
          id,
          original_description,
          quantity,
          unit,
          rate,
          tax_percent,
          taxable_value,
          hsn_sac,
          line_total,
          item_type
        )
      `,
      )
      .eq("vendor_id", vendorId)
      .order("invoice_date", { ascending: false });
    setLoading(false);
    if (error) {
      setInvoices([]);
      return;
    }
    setInvoices((data ?? []) as InvoiceRow[]);
  }, [vendorId]);

  useEffect(() => {
    if (open) {
      void fetchInvoices();
      setSearch("");
      setExpanded({});
    }
  }, [open, fetchInvoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) => (inv.invoice_number ?? "").toLowerCase().includes(q));
  }, [invoices, search]);

  const stats = useMemo(() => {
    if (invoices.length === 0) {
      return {
        totalInvoices: 0,
        totalValue: 0,
        avgValue: 0,
        dateMin: null as string | null,
        dateMax: null as string | null,
        topItems: [] as { label: string; count: number }[],
      };
    }
    const totals = invoices.map((i) => Number(i.total_amount) || 0);
    const totalValue = totals.reduce((a, b) => a + b, 0);
    const dates = invoices.map((i) => i.invoice_date).filter(Boolean) as string[];
    const freq = new Map<string, number>();
    invoices.forEach((inv) => {
      (inv.invoice_line_items ?? []).forEach((li) => {
        const label = (li.original_description ?? "").trim() || "—";
        freq.set(label, (freq.get(label) ?? 0) + 1);
      });
    });
    const topItems = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, count]) => ({ label, count }));
    return {
      totalInvoices: invoices.length,
      totalValue,
      avgValue: totalValue / invoices.length,
      dateMin: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null,
      dateMax: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
      topItems,
    };
  }, [invoices]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col p-0 gap-0">
        <SheetHeader className="p-6 pb-4 border-b border-border shrink-0 text-left">
          <SheetTitle className="pr-8">Invoice history</SheetTitle>
          <SheetDescription className="space-y-2 pt-2">
            <div>
              <p className="font-semibold text-foreground">{supplierName}</p>
              <p className="text-xs font-mono text-muted-foreground">{gstin ?? "No GSTIN"}</p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <Badge className={cn("text-xs border-0", statusBadgeClass(status))}>{status}</Badge>
              <span className="text-xs text-muted-foreground">
                Total PO value: <strong className="text-foreground">{formatMoney(totalPoValue)}</strong>
              </span>
            </div>
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-6 space-y-6">
            {!vendorId && (
              <p className="text-sm text-muted-foreground">
                This supplier is not linked to a vendor ledger record yet, so invoice history is unavailable.
              </p>
            )}

            {vendorId && loading && (
              <p className="text-sm text-muted-foreground">Loading invoices…</p>
            )}

            {vendorId && !loading && invoices.length === 0 && (
              <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
                No invoice history found
              </div>
            )}

            {vendorId && !loading && invoices.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Card>
                    <CardHeader className="pb-1">
                      <CardTitle className="text-xs font-medium text-muted-foreground">Total invoices</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xl font-bold">{stats.totalInvoices}</CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-1">
                      <CardTitle className="text-xs font-medium text-muted-foreground">Total value</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xl font-bold">{formatMoney(stats.totalValue)}</CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-1">
                      <CardTitle className="text-xs font-medium text-muted-foreground">Average</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xl font-bold">{formatMoney(stats.avgValue)}</CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-1">
                      <CardTitle className="text-xs font-medium text-muted-foreground">Date range</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm font-medium leading-tight">
                      {stats.dateMin && stats.dateMax ? (
                        <>
                          {stats.dateMin}
                          <br />
                          <span className="text-muted-foreground">to</span> {stats.dateMax}
                        </>
                      ) : (
                        "—"
                      )}
                    </CardContent>
                  </Card>
                </div>

                {stats.topItems.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Common line descriptions</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-1">
                      {stats.topItems.map((t) => (
                        <div key={t.label} className="flex justify-between gap-2">
                          <span className="truncate text-muted-foreground" title={t.label}>
                            {t.label}
                          </span>
                          <span className="shrink-0 font-medium">{t.count}×</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search invoice number…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>

                <div className="space-y-2">
                  {filtered.map((inv) => {
                    const lines = inv.invoice_line_items ?? [];
                    const isOpen = expanded[inv.id] ?? false;
                    return (
                      <Collapsible
                        key={inv.id}
                        open={isOpen}
                        onOpenChange={(v) => setExpanded((prev) => ({ ...prev, [inv.id]: v }))}
                      >
                        <div className="rounded-lg border bg-card">
                          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-muted/40 rounded-t-lg">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 shrink-0 text-primary" />
                                <span className="font-medium truncate">{inv.invoice_number}</span>
                              </div>
                              <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                <span>{inv.invoice_date ?? "—"}</span>
                                <span>{formatMoney(inv.total_amount)}</span>
                                <span>{inv.document_type ?? "—"}</span>
                                <span>{lines.length} line(s)</span>
                                {inv.extraction_confidence != null && (
                                  <span>Confidence {inv.extraction_confidence}%</span>
                                )}
                              </div>
                            </div>
                            <ChevronDown
                              className={cn("h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-180")}
                            />
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="px-3 pb-3 overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Description</TableHead>
                                    <TableHead className="w-16">Qty</TableHead>
                                    <TableHead className="w-16">Unit</TableHead>
                                    <TableHead className="w-20">Rate</TableHead>
                                    <TableHead className="w-16">Tax %</TableHead>
                                    <TableHead className="w-20">HSN</TableHead>
                                    <TableHead className="w-24">Total</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {lines.map((li) => (
                                    <TableRow key={li.id}>
                                      <TableCell className="max-w-[180px] text-sm">
                                        {li.original_description ?? "—"}
                                      </TableCell>
                                      <TableCell className="text-sm">{li.quantity ?? "—"}</TableCell>
                                      <TableCell className="text-sm">{li.unit ?? "—"}</TableCell>
                                      <TableCell className="text-sm">{formatMoney(li.rate)}</TableCell>
                                      <TableCell className="text-sm">{li.tax_percent ?? "—"}</TableCell>
                                      <TableCell className="text-sm font-mono text-xs">{li.hsn_sac ?? "—"}</TableCell>
                                      <TableCell className="text-sm">{formatMoney(li.line_total)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
