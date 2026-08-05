/**
 * Phase 6 — Founder exception board (brief §4.3).
 *
 * READ-ONLY. It aggregates views that already exist from Phases 2–5 and adds
 * nothing of its own. No action can be taken from here.
 *
 * EVERY bypass appears, regardless of who approved it. Delegated approval must
 * never mean reduced visibility — that is precisely what makes delegating the
 * approval to the EA safe.
 */

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertCircle, ShieldAlert, Clock, FileWarning } from "lucide-react";

import {
  BYPASS_AUTHORITY_LABELS, formatInr, type BypassAuthority,
} from "@/lib/paymentRequests";

type Board = {
  overdue_prqs: number;
  bypasses_total: number;
  bypasses_docs_overdue: number;
  bypasses_awaiting_decision: number;
  po_pi_exceptions: number;
  discretionary_holds: number;
  oldest_discretionary_hold_days: number;
  backfills_this_month: number;
};

type BypassRow = {
  prq_id: string; prq_number: string; party_or_work: string | null;
  net_amount: number | null; status: string;
  bypass_status: string; bypass_reason: string | null;
  bypass_approved_by_name: string | null;
  bypass_authority: BypassAuthority | null;
  bypass_authority_holder: string | null;
  bypass_approved_at: string | null;
  bypass_document_deadline: string | null;
  days_since_approval: number | null;
  documents_required: number; documents_verified: number;
  documents_overdue: boolean;
  requested_by_name: string | null; project_name: string | null;
};

type HoldRow = {
  hold_category: string; held_now: number;
  avg_days_held: number | null; oldest_days: number | null;
};

export default function FounderExceptionBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [bypasses, setBypasses] = useState<BypassRow[]>([]);
  const [holds, setHolds] = useState<HoldRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [b, by, h] = await Promise.all([
        supabase.from("cps_v_founder_exception_board").select("*").maybeSingle(),
        supabase.from("cps_v_prq_bypasses").select("*").order("bypass_approved_at", { ascending: false }),
        supabase.from("cps_v_prq_holds_by_category").select("*"),
      ]);
      if (b.error) toast.error("Could not load the exception board");
      setBoard((b.data ?? null) as unknown as Board | null);
      setBypasses((by.data ?? []) as unknown as BypassRow[]);
      setHolds((h.data ?? []) as unknown as HoldRow[]);
      setLoading(false);
    })();
  }, []);

  const tiles = board ? [
    { label: "Overdue requests", value: board.overdue_prqs, icon: Clock, tone: board.overdue_prqs > 0 ? "text-amber-700" : "" },
    { label: "Bypasses (all time)", value: board.bypasses_total, icon: ShieldAlert, tone: board.bypasses_total > 0 ? "text-red-700" : "" },
    { label: "Bypass docs overdue", value: board.bypasses_docs_overdue, icon: FileWarning, tone: board.bypasses_docs_overdue > 0 ? "text-red-700" : "" },
    { label: "Bypasses awaiting decision", value: board.bypasses_awaiting_decision, icon: ShieldAlert, tone: "" },
    { label: "Discretionary holds", value: board.discretionary_holds, icon: Clock, tone: board.discretionary_holds > 0 ? "text-amber-700" : "" },
    { label: "PO/PI exceptions", value: board.po_pi_exceptions, icon: AlertCircle, tone: "" },
    { label: "Fields backfilled this month", value: board.backfills_this_month, icon: AlertCircle, tone: "" },
  ] : [];

  return (
    <div className="space-y-4 lg:space-y-6">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-foreground">Exception Board</h1>
        <p className="text-muted-foreground text-xs lg:text-sm mt-1">
          Everything that went around the normal path. Read-only.
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {tiles.map((t) => (
              <Card key={t.label}>
                <CardContent className="p-4">
                  <div className={`text-2xl font-bold ${t.tone}`}>{t.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <t.icon className="h-3 w-3" />{t.label}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Bypasses — every one, whoever approved it */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <h2 className="text-sm font-semibold">Bypassed payments</h2>
              <p className="text-xs text-muted-foreground">
                Approved by whom, and under whose authority. A bypass approved by the EA is
                shown as the founder's delegated authority, not simply as her own decision.
              </p>
              {!bypasses.length ? (
                <p className="text-sm text-muted-foreground pt-2">No bypasses recorded.</p>
              ) : (
                <div className="rounded-md border overflow-x-auto mt-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Request</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Approved by</TableHead>
                        <TableHead>Authority</TableHead>
                        <TableHead>Age</TableHead>
                        <TableHead>Documents since</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bypasses.map((b) => (
                        <TableRow key={b.prq_id}>
                          <TableCell>
                            <div className="font-medium">{b.prq_number}</div>
                            <div className="text-xs text-muted-foreground">
                              {b.party_or_work} · {b.project_name ?? "—"}
                            </div>
                            {b.bypass_reason && (
                              <div className="text-xs text-muted-foreground italic mt-0.5">
                                “{b.bypass_reason}”
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            {formatInr(b.net_amount)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {b.bypass_status === "requested"
                              ? <Badge variant="outline" className="text-[10px]">awaiting decision</Badge>
                              : b.bypass_approved_by_name ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {b.bypass_authority ? (
                              <>
                                <Badge className={`border-0 text-[10px] ${
                                  b.bypass_authority === "founder"
                                    ? "bg-slate-100 text-slate-800"
                                    : "bg-amber-100 text-amber-800"}`}>
                                  {BYPASS_AUTHORITY_LABELS[b.bypass_authority]}
                                </Badge>
                                {b.bypass_authority !== "founder" && b.bypass_authority_holder && (
                                  <div className="text-muted-foreground mt-0.5">
                                    {b.bypass_authority_holder}'s authority
                                  </div>
                                )}
                              </>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {b.days_since_approval != null ? `${b.days_since_approval}d` : "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {b.documents_verified}/{b.documents_required} verified
                            {b.documents_overdue && (
                              <Badge className="ml-1.5 border-0 bg-red-100 text-red-800 text-[10px]">
                                overdue
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Discretionary holds by age */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <h2 className="text-sm font-semibold">Holds by category</h2>
              <p className="text-xs text-muted-foreground">
                Discretionary holds are separated from genuine compliance failures. Without
                that split every hold reads as a system failure.
              </p>
              {!holds.length ? (
                <p className="text-sm text-muted-foreground pt-2">Nothing on hold.</p>
              ) : (
                <div className="flex flex-wrap gap-3 pt-1">
                  {holds.map((h) => (
                    <div key={h.hold_category} className="rounded-md border p-3 min-w-[150px]">
                      <div className="text-lg font-bold">{h.held_now}</div>
                      <div className="text-xs font-medium">{h.hold_category}</div>
                      <div className="text-xs text-muted-foreground">
                        avg {h.avg_days_held ?? 0}d · oldest {h.oldest_days ?? 0}d
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
