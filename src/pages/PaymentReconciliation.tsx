import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, TrendingDown } from "lucide-react";

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string | null | undefined) =>
  !d ? "—" : new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

interface ReconciliationRow {
  po_number: string;
  supplier_name: string;
  milestone_name: string;
  tranche_status: string;
  authorized_amount: number | null;
  executed_amount: number | null;
  amount_mismatch_flag: boolean;
  balance_pending: number;
  advance_number: string | null;
  advance_status: string | null;
  reconcile_due_date: string | null;
}

export default function PaymentReconciliation() {
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ authorized: 0, executed: 0, mismatch_count: 0, aging_advances: 0 });

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cps_v_po_payment_reconciliation")
        .select("*")
        .is("tranche_id", false) // Filter out null tranches (POs with no schedule yet)
        .neq("tranche_id", null)
        .order("po_created_at", { ascending: false });

      if (error) throw error;

      const rows = (data ?? []) as ReconciliationRow[];
      setRows(rows);

      // Compute summary
      let authorized = 0,
        executed = 0,
        mismatch_count = 0,
        aging_advances = 0;
      rows.forEach((r) => {
        authorized += Number(r.authorized_amount || 0);
        executed += Number(r.executed_amount || 0);
        if (r.amount_mismatch_flag) mismatch_count++;
        if (r.advance_status === "overdue") aging_advances++;
      });
      setSummary({ authorized, executed, mismatch_count, aging_advances });
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading reconciliation…</p>;

  const mismatches = rows.filter((r) => r.amount_mismatch_flag);
  const aging = rows.filter((r) => r.advance_status === "overdue");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Payment Reconciliation</h1>
        <p className="text-sm text-muted-foreground">Authorized vs. executed amounts + aging advances</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Authorized</p>
            <p className="text-2xl font-bold text-[hsl(20,50%,35%)]">{fmt(summary.authorized)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Executed</p>
            <p className="text-2xl font-bold text-green-700">{fmt(summary.executed)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Mismatches</p>
            <p className="text-2xl font-bold text-red-700">{summary.mismatch_count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Aging Advances</p>
            <p className="text-2xl font-bold text-amber-700">{summary.aging_advances}</p>
          </CardContent>
        </Card>
      </div>

      {/* Mismatches */}
      {mismatches.length > 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-red-700">
              <AlertCircle className="h-4 w-4" /> {mismatches.length} Amount Mismatches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {mismatches.map((r, i) => (
                <div key={i} className="border-l-2 border-red-300 pl-3 py-2 text-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{r.po_number}</p>
                      <p className="text-xs text-muted-foreground">{r.supplier_name} · {r.milestone_name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-red-700 font-semibold">Auth {fmt(r.authorized_amount)} ≠ Exec {fmt(r.executed_amount)}</p>
                      <p className="text-xs text-amber-600">Diff: {fmt(Number(r.authorized_amount || 0) - Number(r.executed_amount || 0))}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Aging advances */}
      {aging.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
              <TrendingDown className="h-4 w-4" /> {aging.length} Overdue Advances
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {aging.map((r, i) => (
                <div key={i} className="border-l-2 border-amber-300 pl-3 py-2 text-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{r.advance_number}</p>
                      <p className="text-xs text-muted-foreground">{r.supplier_name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-amber-700 font-semibold">Due: {fmtDate(r.reconcile_due_date)}</p>
                      <Badge variant="outline" className="text-amber-700 border-amber-300 mt-1">
                        {r.advance_status}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All tranches table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle className="h-4 w-4" /> All Tranches ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 px-2">PO</th>
                  <th className="text-left py-2 px-2">Supplier</th>
                  <th className="text-left py-2 px-2">Installment</th>
                  <th className="text-right py-2 px-2">Authorized</th>
                  <th className="text-right py-2 px-2">Executed</th>
                  <th className="text-center py-2 px-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className={`border-b hover:bg-muted/50 ${r.amount_mismatch_flag ? "bg-red-50" : ""}`}
                  >
                    <td className="py-2 px-2 font-mono text-xs">{r.po_number}</td>
                    <td className="py-2 px-2 text-xs">{r.supplier_name}</td>
                    <td className="py-2 px-2 text-xs">{r.milestone_name}</td>
                    <td className="py-2 px-2 text-right font-medium">{fmt(r.authorized_amount)}</td>
                    <td className="py-2 px-2 text-right font-medium text-green-700">{fmt(r.executed_amount)}</td>
                    <td className="py-2 px-2 text-center">
                      <Badge
                        variant={
                          r.amount_mismatch_flag ? "destructive" : r.tranche_status === "authorized" ? "default" : "outline"
                        }
                        className="text-xs"
                      >
                        {r.tranche_status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
