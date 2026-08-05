/**
 * Phase 1 — Vendor Payment Readiness.
 *
 * VISIBILITY ONLY. This screen reports which suppliers are missing the master
 * data needed to pay them. It blocks nothing: no action anywhere in CPS is
 * prevented by `payment_ready` being false.
 *
 * Reads cps_v_supplier_payment_readiness (which treats '' and whitespace as
 * missing) and writes corrections straight back to cps_suppliers, auditing
 * every field change. profile_complete is deliberately untouched — it measures
 * RFQ-dispatch readiness, not payability.
 */

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDebounce } from "@/hooks/useDebounce";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download, Upload, Check, X, Edit3, Search, AlertCircle } from "lucide-react";

import {
  type PaymentReadinessRow, type EditableField, type MissingField,
  EDITABLE_FIELDS, FIELD_LABELS, MISSING_LABELS, MISSING_TO_COLUMN,
  formatInr, isBlank, logReadinessChange, toCsv, downloadCsv,
} from "@/lib/paymentReadiness";
import PaymentReadinessImportDialog from "./PaymentReadinessImportDialog";

type FilterKey = "all" | "missing_bank" | "missing_pan" | "missing_gstin" | "ready";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "missing_bank", label: "Missing bank" },
  { key: "missing_pan", label: "Missing PAN" },
  { key: "missing_gstin", label: "Missing GSTIN" },
  { key: "ready", label: "Payment ready" },
];

export default function PaymentReadinessTab() {
  const { canManageSuppliers, user } = useAuth();

  const [rows, setRows] = useState<PaymentReadinessRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [activeOnly, setActiveOnly] = useState(true); // default per brief §5
  const [filter, setFilter] = useState<FilterKey>("all");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<EditableField, string>>(blankDraft());
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  function blankDraft(): Record<EditableField, string> {
    return {
      gstin: "", pan: "", bank_account_number: "",
      bank_ifsc: "", bank_account_holder_name: "", bank_name: "",
    };
  }

  const fetchRows = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("cps_v_supplier_payment_readiness")
      .select("*")
      .order("total_po_value", { ascending: false });

    if (error) {
      toast.error("Failed to load payment readiness");
      setRows([]);
    } else {
      setRows((data ?? []) as unknown as PaymentReadinessRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Baseline metric — always measured over ACTIVE suppliers, independent of
     the current filter, so the number on screen tracks Phase 1 progress. */
  const stats = useMemo(() => {
    const active = rows.filter((r) => r.is_active);
    const ready = active.filter((r) => r.payment_ready).length;
    return {
      active: active.length,
      ready,
      pct: active.length ? Math.round((ready / active.length) * 100) : 0,
      missingBank: active.filter((r) => !r.has_bank_account).length,
      missingIfsc: active.filter((r) => !r.has_ifsc).length,
      missingPan: active.filter((r) => !r.has_pan).length,
      missingGstin: active.filter((r) => !r.has_gstin).length,
    };
  }, [rows]);

  const visible = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeOnly && !r.is_active) return false;
      if (q && !r.supplier_name?.toLowerCase().includes(q)) return false;
      switch (filter) {
        case "missing_bank":  return !r.has_bank_account || !r.has_ifsc;
        case "missing_pan":   return !r.has_pan;
        case "missing_gstin": return !r.has_gstin;
        case "ready":         return r.payment_ready;
        default:              return true;
      }
    });
  }, [rows, debouncedSearch, activeOnly, filter]);

  const startEdit = (r: PaymentReadinessRow) => {
    // Initialised from the row in the click handler — never synced from props
    // in an effect (see CLAUDE.md → React State Patterns).
    setDraft({
      gstin: r.gstin ?? "",
      pan: r.pan ?? "",
      bank_account_number: r.bank_account_number ?? "",
      bank_ifsc: r.bank_ifsc ?? "",
      bank_account_holder_name: r.bank_account_holder_name ?? "",
      bank_name: r.bank_name ?? "",
    });
    setEditingId(r.supplier_id);
  };

  const cancelEdit = () => { setEditingId(null); setDraft(blankDraft()); };

  const saveEdit = async (r: PaymentReadinessRow) => {
    const before: Partial<Record<EditableField, string | null>> = {};
    const after: Partial<Record<EditableField, string | null>> = {};
    const payload: Record<string, string | null> = {};

    for (const f of EDITABLE_FIELDS) {
      const nextRaw = draft[f].trim();
      const next = nextRaw === "" ? null : nextRaw;
      const prev = (r[f] ?? null) as string | null;
      const prevNorm = isBlank(prev) ? null : (prev as string).trim();
      if (next !== prevNorm) {
        payload[f] = next;
        before[f] = prev;
        after[f] = next;
      }
    }

    if (!Object.keys(payload).length) { cancelEdit(); return; }

    setSaving(true);
    const { error } = await supabase
      .from("cps_suppliers")
      .update(payload)
      .eq("id", r.supplier_id);
    setSaving(false);

    if (error) { toast.error("Could not save: " + error.message); return; }

    await logReadinessChange({
      user, supplierId: r.supplier_id, supplierName: r.supplier_name,
      before, after, source: "inline_edit",
    });

    toast.success(`Updated ${r.supplier_name}`);
    cancelEdit();
    fetchRows();
  };

  const exportGap = () => {
    const headers = [
      "supplier_name", "po_count", "total_po_value", "last_po_at",
      "gstin", "pan", "bank_account_number", "bank_ifsc",
      "bank_account_holder_name", "bank_name", "missing_fields", "payment_ready",
    ];
    const body = visible.map((r) => [
      r.supplier_name, r.po_count, r.total_po_value ?? 0,
      r.last_po_at ? r.last_po_at.slice(0, 10) : "",
      r.gstin ?? "", r.pan ?? "", r.bank_account_number ?? "", r.bank_ifsc ?? "",
      r.bank_account_holder_name ?? "", r.bank_name ?? "",
      (r.missing_fields ?? []).join(" | "), r.payment_ready ? "yes" : "no",
    ]);
    downloadCsv(`payment-readiness-gap-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(headers, body));
    toast.success(`Exported ${body.length} suppliers`);
  };

  const chips = (r: PaymentReadinessRow) => {
    const missing = (r.missing_fields ?? []) as MissingField[];
    if (!missing.length) {
      return <Badge className="border-0 bg-green-100 text-green-800 text-xs">Payment ready</Badge>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {missing.map((m) => (
          <Badge
            key={m}
            className="border-0 bg-red-100 text-red-800 text-xs font-normal"
            title={`Missing ${MISSING_LABELS[m]} — column ${MISSING_TO_COLUMN[m]}`}
          >
            {MISSING_LABELS[m]}
          </Badge>
        ))}
      </div>
    );
  };

  const editorFields = (r: PaymentReadinessRow) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3 bg-muted/40 rounded-md">
      {EDITABLE_FIELDS.map((f) => {
        const wasBlank = isBlank(r[f] as string | null);
        return (
          <div key={f} className="space-y-1">
            <Label className="text-xs flex items-center gap-1">
              {FIELD_LABELS[f]}
              {wasBlank && <span className="text-red-600" title="Currently missing">•</span>}
            </Label>
            <Input
              value={draft[f]}
              onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
              placeholder={wasBlank ? `Add ${FIELD_LABELS[f]}` : ""}
              className="h-8 text-sm"
            />
          </div>
        );
      })}
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
        <Button size="sm" onClick={() => saveEdit(r)} disabled={saving}>
          <Check className="h-3.5 w-3.5 mr-1" />{saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
          <X className="h-3.5 w-3.5 mr-1" />Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Summary bar — the Phase 1 progress metric */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-2xl font-bold text-foreground">
                {stats.ready} / {stats.active}{" "}
                <span className="text-base font-normal text-muted-foreground">
                  active suppliers payment-ready ({stats.pct}%)
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Active = has at least one PO. Missing bank a/c {stats.missingBank} ·
                IFSC {stats.missingIfsc} · PAN {stats.missingPan} · GSTIN {stats.missingGstin}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportGap}>
                <Download className="h-4 w-4 mr-1.5" />Export CSV
              </Button>
              {canManageSuppliers && (
                <Button size="sm" onClick={() => setImportOpen(true)}>
                  <Upload className="h-4 w-4 mr-1.5" />Import
                </Button>
              )}
            </div>
          </div>
          <div className="mt-3 h-2 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${stats.pct}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Visibility only — nothing in CPS is blocked by a supplier not being payment-ready.
          </p>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search supplier…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Button
          variant={activeOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveOnly((v) => !v)}
        >
          Active only
        </Button>
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            variant={filter === f.key ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {visible.length} supplier{visible.length === 1 ? "" : "s"}
        {activeOnly ? " with at least one PO" : " (including never-transacted)"}, highest PO value first.
      </p>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : visible.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
          No suppliers match this filter.
        </CardContent></Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">POs</TableHead>
                  <TableHead className="text-right">PO Value</TableHead>
                  <TableHead>Last PO</TableHead>
                  <TableHead>Missing</TableHead>
                  {canManageSuppliers && <TableHead className="w-20" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <React.Fragment key={r.supplier_id}>
                    <TableRow>
                      <TableCell className="font-medium">{r.supplier_name}</TableCell>
                      <TableCell className="text-right">{r.po_count}</TableCell>
                      <TableCell className="text-right">{formatInr(r.total_po_value)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.last_po_at ? r.last_po_at.slice(0, 10) : "—"}
                      </TableCell>
                      <TableCell>{chips(r)}</TableCell>
                      {canManageSuppliers && (
                        <TableCell>
                          <Button
                            variant="ghost" size="sm" className="h-8"
                            onClick={() => (editingId === r.supplier_id ? cancelEdit() : startEdit(r))}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                    {editingId === r.supplier_id && (
                      <TableRow>
                        <TableCell colSpan={canManageSuppliers ? 6 : 5} className="p-2">
                          {editorFields(r)}
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {visible.map((r) => (
              <Card key={r.supplier_id}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{r.supplier_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.po_count} PO{r.po_count === 1 ? "" : "s"} · {formatInr(r.total_po_value)}
                        {r.last_po_at ? ` · ${r.last_po_at.slice(0, 10)}` : ""}
                      </div>
                    </div>
                    {canManageSuppliers && (
                      <Button
                        variant="ghost" size="sm" className="h-8 shrink-0"
                        onClick={() => (editingId === r.supplier_id ? cancelEdit() : startEdit(r))}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  {chips(r)}
                  {editingId === r.supplier_id && editorFields(r)}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {importOpen && (
        <PaymentReadinessImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          rows={rows}
          onImported={fetchRows}
        />
      )}
    </div>
  );
}
