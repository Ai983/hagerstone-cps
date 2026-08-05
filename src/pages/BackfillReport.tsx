/**
 * Phase 2 — Backfill report.
 *
 * This is the accountability mechanism that REPLACES blocking (spec §4.0).
 * Because procurement absorbs whatever site leaves blank, site bears no cost
 * for skipping — so the skip is counted instead of blocked, per site engineer
 * per month, visible to the project head and the founder.
 *
 * Built in Phase 2 rather than later on purpose: retrofitting loses the first
 * month of data, which is the month that decides whether site ever needs a
 * hard block.
 *
 * Reports only. Nothing here blocks anyone.
 */

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download, AlertCircle } from "lucide-react";

import { toCsv, downloadCsv } from "@/lib/paymentReadiness";

type BackfillRow = {
  site_user_id: string | null;
  site_user_name: string | null;
  site_user_email: string | null;
  site_user_role: string | null;
  month: string;
  fields_filled: number;
  documents_filled: number;
  total_backfilled: number;
};

type ExceptionRow = { month: string; count: number };

/**
 * Phase 4 ships this INSTEAD of blocking. cps_users.pr_blocked stays wired to
 * invoice deadlines only — whether PRQ failures should ever block is a decision
 * to make after a month of real data, with evidence.
 */
type OffenderRow = {
  user_id: string; user_name: string | null; user_email: string | null;
  month: string; prqs_raised: number; deadlines_missed: number;
  rolled_forward: number; total_rolls: number; raised_with_blanks: number;
};

export default function BackfillReport() {
  const [rows, setRows] = useState<BackfillRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [offenders, setOffenders] = useState<OffenderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const [{ data, error }, { data: exc }, { data: off }] = await Promise.all([
        supabase.from("cps_v_prq_backfill_by_engineer").select("*").order("month", { ascending: false }),
        supabase.from("cps_payment_requests")
          .select("po_pi_exception_at")
          .eq("po_pi_not_applicable", true),
        supabase.from("cps_v_prq_repeat_offenders").select("*").order("month", { ascending: false }),
      ]);
      setOffenders((off ?? []) as unknown as OffenderRow[]);

      if (error) toast.error("Failed to load backfill report");
      setRows((data ?? []) as unknown as BackfillRow[]);

      const byMonth = new Map<string, number>();
      for (const e of (exc ?? []) as { po_pi_exception_at: string | null }[]) {
        const m = e.po_pi_exception_at ? e.po_pi_exception_at.slice(0, 7) : "unknown";
        byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
      }
      setExceptions([...byMonth].map(([m, count]) => ({ month: m, count })).sort((a, b) => b.month.localeCompare(a.month)));
      setLoading(false);
    })();
  }, []);

  const months = useMemo(
    () => [...new Set(rows.map((r) => r.month?.slice(0, 7)).filter(Boolean))].sort().reverse(),
    [rows],
  );

  const visible = useMemo(
    () => (month === "all" ? rows : rows.filter((r) => r.month?.slice(0, 7) === month))
      .slice()
      .sort((a, b) => b.total_backfilled - a.total_backfilled),
    [rows, month],
  );

  const totals = useMemo(() => ({
    fields: visible.reduce((s, r) => s + Number(r.fields_filled ?? 0), 0),
    docs: visible.reduce((s, r) => s + Number(r.documents_filled ?? 0), 0),
    people: new Set(visible.map((r) => r.site_user_id)).size,
  }), [visible]);

  const exportCsv = () => {
    downloadCsv(
      `backfill-report-${month}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ["site_engineer", "email", "role", "month", "fields_filled", "documents_filled", "total"],
        visible.map((r) => [
          r.site_user_name ?? "(unknown)", r.site_user_email ?? "", r.site_user_role ?? "",
          r.month?.slice(0, 7) ?? "", r.fields_filled, r.documents_filled, r.total_backfilled,
        ]),
      ),
    );
    toast.success(`Exported ${visible.length} row(s)`);
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground">Backfill Report</h1>
          <p className="text-muted-foreground text-xs lg:text-sm mt-1">
            Per site engineer, per month — how many fields and documents procurement had to fill in.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!visible.length}>
          <Download className="h-4 w-4 mr-1.5" />Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span><span className="font-semibold">{totals.fields}</span> fields backfilled</span>
            <span><span className="font-semibold">{totals.docs}</span> documents backfilled</span>
            <span><span className="font-semibold">{totals.people}</span> site engineer(s)</span>
          </div>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Counted, not blocked. After a month of real data this is what decides whether site ever needs a hard block.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={month === "all" ? "default" : "outline"} onClick={() => setMonth("all")}>
          All months
        </Button>
        {months.map((m) => (
          <Button key={m} size="sm" variant={month === m ? "default" : "outline"} onClick={() => setMonth(m)}>
            {m}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : !visible.length ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
          Nothing backfilled yet. This fills up as procurement completes fields site left blank.
        </CardContent></Card>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site Engineer</TableHead>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Fields</TableHead>
                <TableHead className="text-right">Documents</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r, i) => (
                <TableRow key={`${r.site_user_id}-${r.month}-${i}`}>
                  <TableCell>
                    <div className="font-medium">{r.site_user_name ?? "(unknown user)"}</div>
                    <div className="text-xs text-muted-foreground">{r.site_user_email}</div>
                  </TableCell>
                  <TableCell className="text-xs">{r.month?.slice(0, 7)}</TableCell>
                  <TableCell className="text-right">{r.fields_filled}</TableCell>
                  <TableCell className="text-right">{r.documents_filled}</TableCell>
                  <TableCell className="text-right font-semibold">{r.total_backfilled}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Phase 4 — ships instead of blocking */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <h3 className="text-sm font-semibold">Deadline performance by requester</h3>
          <p className="text-xs text-muted-foreground">
            CPS has a working block mechanism (<code>pr_blocked</code>, used for invoice deadlines).
            It is deliberately <span className="font-medium">not</span> wired to payment requests.
            This report ships instead, so blocking can be decided after a month of real data
            rather than by assumption.
          </p>
          {offenders.length ? (
            <div className="rounded-md border overflow-x-auto mt-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Requester</TableHead>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Raised</TableHead>
                    <TableHead className="text-right">Deadlines missed</TableHead>
                    <TableHead className="text-right">Rolled forward</TableHead>
                    <TableHead className="text-right">Raised with blanks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offenders.map((o, i) => (
                    <TableRow key={`${o.user_id}-${o.month}-${i}`}>
                      <TableCell>
                        <div className="font-medium">{o.user_name ?? "(unknown)"}</div>
                        <div className="text-xs text-muted-foreground">{o.user_email}</div>
                      </TableCell>
                      <TableCell className="text-xs">{o.month?.slice(0, 7)}</TableCell>
                      <TableCell className="text-right">{o.prqs_raised}</TableCell>
                      <TableCell className={`text-right ${o.deadlines_missed > 0 ? "text-amber-700 font-medium" : ""}`}>
                        {o.deadlines_missed}
                      </TableCell>
                      <TableCell className="text-right">{o.rolled_forward}</TableCell>
                      <TableCell className="text-right">{o.raised_with_blanks}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No payment requests raised yet.</p>
          )}
        </CardContent>
      </Card>

      {/* D1 exception counter — "report how often this is used" */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <h3 className="text-sm font-semibold">PO/PI not applicable — exception usage</h3>
          <p className="text-xs text-muted-foreground">
            Local and non-GST purchases have no PO today. Rather than forcing a PI or silently dropping the
            requirement, procurement marks the line with a written reason and it is counted here. This is the
            data that decides the question properly in Phase 3.
          </p>
          {exceptions.length ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {exceptions.map((e) => (
                <Badge key={e.month} variant="outline" className="text-xs">
                  {e.month}: {e.count}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No exceptions recorded yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
