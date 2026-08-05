/**
 * Phase 2 — Payment Requests board (procurement).
 *
 * One row per sheet line, because that is the point of splitting the sheet:
 * today a single missing document on row 3 stalls the entire sheet, and after
 * this each line is chased on its own.
 *
 * NO GATE. This board reports state and lets procurement act; it never
 * prevents anything, here or elsewhere in CPS.
 */

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useDebounce } from "@/hooks/useDebounce";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, AlertCircle, AlertTriangle, ShieldAlert, Unlink, Link2 } from "lucide-react";

import {
  PAYMENT_TYPE_LABELS, PAYMENT_KIND_LABELS, PRQ_STATUS_LABELS, FIELD_LABELS,
  formatInr, type PaymentRequest, type PaymentSheet,
} from "@/lib/paymentRequests";
import PrqDetailDialog from "@/components/payments/PrqDetailDialog";

type Row = PaymentRequest & {
  sheet_number: string | null;
  project_id: string | null;
  project_name: string | null;
  expected_payment_date: string | null;
};

const BLOCKING = ["all", "site", "procurement", "accounts", "founder"] as const;

/**
 * Mirrors the prq_finance_ready_needs_link constraint, so the board never flags
 * a row the database considers fine: labour needs a work order, vendor needs a
 * PO, individual_direct is exempt (its controls are basis_of_payment +
 * named_approver on the checklist), and the exception satisfies any type.
 */
/**
 * Countdown to the PRQ deadline (expected_payment_date − lead time, end of day
 * IST). Display only — passing it blocks nothing in Phase 4.
 */
const hoursLeft = (deadline: string) =>
  (new Date(deadline).getTime() - Date.now()) / 3_600_000;

const deadlineLabel = (deadline: string) => {
  const h = hoursLeft(deadline);
  if (h < 0) return `deadline passed ${Math.abs(Math.round(h / 24))}d ago`;
  if (h < 24) return `${Math.max(1, Math.round(h))}h left`;
  return `${Math.round(h / 24)}d left`;
};

const deadlineTone = (deadline: string) => {
  const h = hoursLeft(deadline);
  if (h < 0) return "text-destructive font-medium";
  if (h <= 12) return "text-amber-700 font-medium";
  return "text-muted-foreground";
};

const isLinked = (r: Row) =>
  r.payment_type === "individual_direct"
  || (r.payment_type === "labour_contractor" ? !!r.against_wo_id : !!r.against_po_id)
  || r.po_pi_not_applicable;

export default function PaymentRequests() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search);
  const [blocking, setBlocking] = useState<(typeof BLOCKING)[number]>("all");
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: prqs, error }, { data: sheets }, { data: projects }] = await Promise.all([
      supabase.from("cps_payment_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("cps_payment_sheets").select("id,sheet_number,project_id,expected_payment_date"),
      supabase.from("cps_projects").select("id,name"),
    ]);

    if (error) {
      toast.error("Failed to load payment requests");
      setRows([]);
      setLoading(false);
      return;
    }

    const sheetById = new Map(
      ((sheets ?? []) as unknown as (PaymentSheet & { id: string })[]).map((s) => [s.id, s]),
    );
    const projById = new Map(
      ((projects ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]),
    );

    setRows(
      ((prqs ?? []) as unknown as PaymentRequest[]).map((p) => {
        const sh = p.sheet_id ? sheetById.get(p.sheet_id) : undefined;
        return {
          ...p,
          sheet_number: sh?.sheet_number ?? null,
          project_id: sh?.project_id ?? null,
          project_name: sh?.project_id ? projById.get(sh.project_id) ?? null : null,
          expected_payment_date: sh?.expected_payment_date ?? null,
        };
      }),
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => ({
    total: rows.length,
    open: rows.filter((r) => !["paid", "closed", "cancelled"].includes(r.status)).length,
    withBlanks: rows.filter((r) => (r.blank_fields?.length ?? 0) > 0).length,
    exceptions: rows.filter((r) => r.po_pi_not_applicable).length,
    overrides: rows.filter((r) => r.bank_source === "site_override").length,
    unlinked: rows.filter((r) => !isLinked(r)
      && !["paid", "closed", "cancelled"].includes(r.status)).length,
    linkedBySite: rows.filter((r) => r.link_source === "site").length,
    unconfirmed: rows.filter((r) => r.needs_confirmation).length,
  }), [rows]);

  const visible = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (statusFilter === "open" && ["paid", "closed", "cancelled"].includes(r.status)) return false;
        if (unlinkedOnly && isLinked(r)) return false;
        if (blocking !== "all" && r.blocking_party !== blocking) return false;
        if (q) {
          const hay = `${r.prq_number} ${r.party_or_work ?? ""} ${r.beneficiary_name ?? ""} ${r.sheet_number ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      // Sorted by expected payment date — soonest first, undated last.
      .sort((a, b) => {
        const av = a.expected_payment_date ?? "9999-12-31";
        const bv = b.expected_payment_date ?? "9999-12-31";
        return av.localeCompare(bv);
      });
  }, [rows, debounced, blocking, statusFilter, unlinkedOnly]);

  return (
    <div className="space-y-4 lg:space-y-6">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-foreground">Payment Requests</h1>
        <p className="text-muted-foreground text-xs lg:text-sm mt-1">
          One request per sheet line, soonest expected payment first.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span><span className="font-semibold">{stats.open}</span> open of {stats.total}</span>
          <span className="text-amber-700 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            {stats.withBlanks} with fields site left blank
          </span>
          <span className="text-red-700 flex items-center gap-1">
            <Unlink className="h-3.5 w-3.5" />
            {stats.unlinked} not linked to a PO/WO
          </span>
          <span className="text-amber-700 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            {stats.unconfirmed} machine-guessed, unconfirmed
          </span>
          <span className="text-muted-foreground">{stats.linkedBySite} linked by site</span>
          <span className="text-muted-foreground">{stats.exceptions} PO/PI exceptions</span>
          <span className="text-muted-foreground flex items-center gap-1">
            <ShieldAlert className="h-3.5 w-3.5" />{stats.overrides} bank overrides by site
          </span>
          <span className="w-full text-[11px] text-muted-foreground flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Phase 2 is visibility and capture only — nothing in CPS is blocked by this board.
          </span>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-9" placeholder="Search PRQ, party, beneficiary…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button variant={statusFilter === "open" ? "default" : "outline"} size="sm"
          onClick={() => setStatusFilter(statusFilter === "open" ? "all" : "open")}>
          Open only
        </Button>
        <Button variant={unlinkedOnly ? "default" : "outline"} size="sm"
          onClick={() => setUnlinkedOnly((v) => !v)}>
          <Unlink className="h-3.5 w-3.5 mr-1.5" />Not linked
        </Button>
        {BLOCKING.map((b) => (
          <Button key={b} size="sm" variant={blocking === b ? "default" : "outline"}
            onClick={() => setBlocking(b)}>
            {b === "all" ? "All" : `Blocking: ${b}`}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : !visible.length ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
          No payment requests match this filter.
        </CardContent></Card>
      ) : (
        <>
          <div className="hidden md:block rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PRQ</TableHead>
                  <TableHead>Party / Work</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Missing</TableHead>
                  <TableHead>Link</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {r.prq_number}
                      {r.urgency !== "normal" && (
                        <Badge className="ml-1.5 border-0 bg-red-100 text-red-800 text-[10px]">{r.urgency}</Badge>
                      )}
                      {r.needs_confirmation && (
                        <Badge className="ml-1.5 border-0 bg-amber-100 text-amber-800 text-[10px] font-normal"
                          title={`Machine-guessed, unconfirmed: ${(r.confirmation_fields ?? []).join(", ")}`}>
                          <AlertTriangle className="h-3 w-3 mr-1" />unconfirmed
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate">
                      {r.party_or_work ?? <span className="text-muted-foreground">—</span>}
                      {r.project_name && <div className="text-xs text-muted-foreground truncate">{r.project_name}</div>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {PAYMENT_TYPE_LABELS[r.payment_type]}
                      <div className="text-muted-foreground">
                        {r.payment_kind
                          ? PAYMENT_KIND_LABELS[r.payment_kind]
                          : <span className="italic">kind not set</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatInr(r.net_amount)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.expected_payment_date ?? "—"}
                      {r.prq_deadline && (
                        <div className={deadlineTone(r.prq_deadline)}>
                          {deadlineLabel(r.prq_deadline)}
                        </div>
                      )}
                      {r.roll_count > 0 && (
                        <div className="text-muted-foreground">rolled ×{r.roll_count}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {(r.blank_fields?.length ?? 0) > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {r.blank_fields.slice(0, 3).map((f) => (
                            <Badge key={f} className="border-0 bg-amber-100 text-amber-800 text-[10px] font-normal">
                              {FIELD_LABELS[f] ?? f}
                            </Badge>
                          ))}
                          {r.blank_fields.length > 3 && (
                            <Badge variant="outline" className="text-[10px]">+{r.blank_fields.length - 3}</Badge>
                          )}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {r.against_po_id || r.against_wo_id ? (
                        <Badge className="border-0 bg-green-100 text-green-800 text-[10px] font-normal">
                          <Link2 className="h-3 w-3 mr-1" />
                          linked{r.link_source ? ` · ${r.link_source}` : ""}
                        </Badge>
                      ) : r.po_pi_not_applicable ? (
                        <Badge className="border-0 bg-muted text-muted-foreground text-[10px] font-normal">
                          exception
                        </Badge>
                      ) : r.payment_type === "individual_direct" ? (
                        <Badge className="border-0 bg-muted text-muted-foreground text-[10px] font-normal"
                          title="Individual payments need no PO — basis of payment + named approver are the controls">
                          not required
                        </Badge>
                      ) : (
                        <Badge className="border-0 bg-red-100 text-red-800 text-[10px] font-normal">
                          <Unlink className="h-3 w-3 mr-1" />not linked
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className="border-0 bg-blue-100 text-blue-800 text-xs">
                        {PRQ_STATUS_LABELS[r.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-2">
            {visible.map((r) => (
              <Card key={r.id} onClick={() => setSelected(r)} className="cursor-pointer">
                <CardContent className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">{r.prq_number}</span>
                    <Badge className="border-0 bg-blue-100 text-blue-800 text-xs">
                      {PRQ_STATUS_LABELS[r.status]}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.party_or_work ?? "—"} · {PAYMENT_TYPE_LABELS[r.payment_type]} · {formatInr(r.net_amount)}
                  </div>
                  {!isLinked(r) && (
                    <Badge className="border-0 bg-red-100 text-red-800 text-[10px] font-normal">
                      <Unlink className="h-3 w-3 mr-1" />not linked to a PO/WO
                    </Badge>
                  )}
                  {(r.blank_fields?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.blank_fields.map((f) => (
                        <Badge key={f} className="border-0 bg-amber-100 text-amber-800 text-[10px] font-normal">
                          {FIELD_LABELS[f] ?? f}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {selected && (
        <PrqDetailDialog
          key={selected.id}
          prq={selected}
          open={!!selected}
          onOpenChange={(v) => !v && setSelected(null)}
          onChanged={load}
          projectId={selected.project_id}
        />
      )}
    </div>
  );
}
