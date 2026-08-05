/**
 * Phase 2 — pick the PO or Work Order a payment is against.
 *
 * NEVER auto-links. The list is filtered hard (vendor AND project AND still has
 * a remaining balance) so the user sees a handful of genuinely relevant
 * documents instead of all 253 POs — measured on live data, that filter yields
 * an average of 1.2 and a worst case of 4 candidates. But the final pick is
 * always a human action: a wrong auto-link points money at the wrong contract,
 * which is worse than no link at all.
 *
 * The project filter can be relaxed in the UI, because a vendor occasionally
 * bills one site against a PO raised on another. Relaxing widens the list; it
 * never picks for you.
 */

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Link2, AlertCircle } from "lucide-react";

import { formatInr } from "@/lib/paymentRequests";

export type LinkableDoc = {
  id: string;
  number: string;
  kind: "po" | "wo";
  total_value: number;
  paid_amount: number;
  balance_amount: number;
  status: string | null;
  created_at: string | null;
  project_id: string | null;
};

export default function LinkDocPicker({
  open, onOpenChange, kind, supplierId, projectId, onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: "po" | "wo";
  supplierId: string | null;
  projectId: string | null;
  onPick: (doc: LinkableDoc) => void;
}) {
  const [docs, setDocs] = useState<LinkableDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [anyProject, setAnyProject] = useState(false);

  useEffect(() => {
    (async () => {
      if (!supplierId) { setDocs([]); setLoading(false); return; }
      setLoading(true);

      const view = kind === "po" ? "cps_v_po_link_candidates" : "cps_v_wo_link_candidates";
      let q = supabase.from(view).select("*").eq("supplier_id", supplierId);
      if (projectId && !anyProject) q = q.eq("project_id", projectId);

      const { data } = await q.order("created_at", { ascending: false });
      setDocs(
        ((data ?? []) as Record<string, unknown>[]).map((d) => ({
          id: String(kind === "po" ? d.po_id : d.wo_id),
          number: String(kind === "po" ? d.po_number : d.wo_number),
          kind,
          total_value: Number(d.total_value ?? 0),
          paid_amount: Number(d.paid_amount ?? 0),
          balance_amount: Number(d.balance_amount ?? 0),
          status: (d.status as string) ?? null,
          created_at: (d.created_at as string) ?? null,
          project_id: (d.project_id as string) ?? null,
        })),
      );
      setLoading(false);
    })();
  }, [supplierId, projectId, kind, anyProject, open]);

  const label = kind === "po" ? "Purchase Order" : "Work Order";

  const body = useMemo(() => {
    if (!supplierId) {
      return (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Link a vendor to this line first — candidates are filtered by vendor.
        </div>
      );
    }
    if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
    if (!docs.length) {
      return (
        <div className="rounded-md border border-dashed p-6 text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            No open {label.toLowerCase()} with a remaining balance for this vendor
            {projectId && !anyProject ? " on this project" : ""}.
          </p>
          {projectId && !anyProject && (
            <Button size="sm" variant="outline" onClick={() => setAnyProject(true)}>
              Search all projects for this vendor
            </Button>
          )}
        </div>
      );
    }
    return (
      <div className="rounded-md border divide-y max-h-80 overflow-y-auto">
        {docs.map((d) => (
          <button key={d.id} type="button"
            className="w-full text-left p-3 hover:bg-muted"
            onClick={() => { onPick(d); onOpenChange(false); }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium text-sm">{d.number}</span>
              <Badge variant="outline" className="text-[10px]">{d.status}</Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Value {formatInr(d.total_value)} · Paid {formatInr(d.paid_amount)} ·{" "}
              <span className="text-foreground font-medium">Balance {formatInr(d.balance_amount)}</span>
              <span className="text-muted-foreground"> as per CPS records</span>
              {d.created_at ? ` · ${d.created_at.slice(0, 10)}` : ""}
            </div>
          </button>
        ))}
      </div>
    );
  }, [docs, loading, supplierId, projectId, anyProject, label, onPick, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />Pick the {label}
          </DialogTitle>
          <DialogDescription>
            Only this vendor's {anyProject ? "documents across all projects" : "documents on this project"} that
            still have money owing. Nothing is linked automatically. Balances are{" "}
            <span className="font-medium">as per CPS records</span> — a PO settled through the WhatsApp
            sheet still shows its full balance here until cutover.
          </DialogDescription>
        </DialogHeader>

        {body}

        {docs.length > 0 && projectId && !anyProject && (
          <Button size="sm" variant="ghost" onClick={() => setAnyProject(true)}>
            Not here? Search all projects for this vendor
          </Button>
        )}
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Optional for site — you can submit without picking.
        </p>
      </DialogContent>
    </Dialog>
  );
}
