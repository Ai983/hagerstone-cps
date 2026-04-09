import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle2, ClipboardList, FileText, Loader2, Palette, Tag } from "lucide-react";

type PR = {
  id: string;
  pr_number: string;
  project_site: string;
  project_code: string | null;
  requested_by: string;
  requested_by_name: string;
  required_by: string;
  created_at: string;
  items_count: number;
};

type LineItem = {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  specs: string | null;
  preferred_brands: string[] | null;
  brand_make: string;
  colour_code: string;
  design_notes: string;
};

const fmt = (d: string) => {
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}/${dt.getFullYear()}`;
};

export default function DesignTeam() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [prs, setPrs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPr, setSelectedPr] = useState<PR | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: rows } = await supabase
      .from("cps_purchase_requisitions")
      .select("id, pr_number, project_site, project_code, requested_by, required_by, created_at")
      .eq("status", "pending_design")
      .order("created_at", { ascending: true });

    if (!rows || rows.length === 0) { setPrs([]); setLoading(false); return; }

    const userIds = [...new Set(rows.map((r: any) => r.requested_by))];
    let userMap: Record<string, string> = {};
    const { data: users } = await supabase.from("cps_users").select("id, name").in("id", userIds);
    if (users) userMap = Object.fromEntries((users as any[]).map(u => [u.id, u.name]));

    const prIds = rows.map((r: any) => r.id);
    let counts: Record<string, number> = {};
    const { data: lines } = await supabase.from("cps_pr_line_items").select("pr_id").in("pr_id", prIds);
    if (lines) lines.forEach((l: any) => { counts[l.pr_id] = (counts[l.pr_id] ?? 0) + 1; });

    setPrs(rows.map((r: any) => ({
      ...r,
      requested_by_name: userMap[r.requested_by] ?? "—",
      items_count: counts[r.id] ?? 0,
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openPr = async (pr: PR) => {
    setSelectedPr(pr);
    setLoadingItems(true);
    const { data } = await supabase
      .from("cps_pr_line_items")
      .select("id, description, quantity, unit, specs, preferred_brands, brand_make, colour_code, design_notes")
      .eq("pr_id", pr.id)
      .order("sort_order");
    setLineItems((data ?? []).map((li: any) => ({
      ...li,
      brand_make: li.brand_make ?? "",
      colour_code: li.colour_code ?? "",
      design_notes: li.design_notes ?? "",
    })));
    setLoadingItems(false);
  };

  const updateItem = (id: string, field: "brand_make" | "colour_code" | "design_notes", value: string) => {
    setLineItems(prev => prev.map(li => li.id === id ? { ...li, [field]: value } : li));
  };

  const submitSpecs = async () => {
    if (!selectedPr || !user) return;
    setSubmitting(true);
    try {
      // Save specs on each line item
      for (const li of lineItems) {
        await supabase.from("cps_pr_line_items").update({
          brand_make: li.brand_make || null,
          colour_code: li.colour_code || null,
          design_notes: li.design_notes || null,
          design_reviewed: true,
          design_reviewed_by: user.id,
          design_reviewed_at: new Date().toISOString(),
        }).eq("id", li.id);
      }

      // Fire auto-RFQ
      const { data: rfqResult, error: rfqErr } = await supabase.rpc("cps_auto_create_rfq_for_pr", {
        p_pr_id: selectedPr.id, p_created_by: user.id,
      });
      if (rfqErr) throw new Error(rfqErr.message);

      if (rfqResult?.success && Array.isArray(rfqResult.rfqs)) {
        await supabase.from("cps_rfqs")
          .update({ status: "draft" })
          .in("id", rfqResult.rfqs.map((r: any) => r.rfq_id));
        const nums = rfqResult.rfqs.map((r: any) => r.rfq_number).join(", ");
        toast.success(`Specs saved — ${nums} created for procurement review.`);
      } else {
        toast.success("Specs saved. Procurement team will create the RFQ.");
      }

      // Audit
      try {
        await supabase.from("cps_audit_log").insert([{
          user_id: user.id, user_name: user.name, user_role: user.role,
          action_type: "DESIGN_SPECS_ADDED", entity_type: "purchase_requisition",
          entity_id: selectedPr.id, entity_number: selectedPr.pr_number,
          description: `Design specs added to ${selectedPr.pr_number} by ${user.name}`,
          severity: "info", logged_at: new Date().toISOString(),
        }]);
      } catch { /* non-blocking */ }

      setSelectedPr(null);
      setLineItems([]);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save specs");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Design Review Queue</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Add brand, colour &amp; spec details before RFQ is dispatched</p>
        </div>
        <Badge className="bg-violet-100 text-violet-800 border-0 text-sm px-3 py-1">
          {loading ? "…" : `${prs.length} pending`}
        </Badge>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 max-w-sm">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-violet-100 flex items-center justify-center">
                <ClipboardList className="h-5 w-5 text-violet-700" />
              </div>
              <div>
                <p className="text-2xl font-bold">{loading ? "—" : prs.length}</p>
                <p className="text-xs text-muted-foreground">Pending Review</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-green-700" />
              </div>
              <div>
                <p className="text-2xl font-bold">—</p>
                <p className="text-xs text-muted-foreground">Done Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PR list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">PRs Awaiting Spec Review</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-4 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : prs.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle2 className="h-10 w-10 mx-auto text-green-400 mb-3" />
              <p className="font-medium">All caught up!</p>
              <p className="text-sm text-muted-foreground mt-1">No PRs awaiting design review.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PR Number</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Required By</TableHead>
                  <TableHead>Raised On</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prs.map(pr => (
                  <TableRow key={pr.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openPr(pr)}>
                    <TableCell className="font-mono text-primary font-semibold">{pr.pr_number}</TableCell>
                    <TableCell>
                      <div className="font-medium">{pr.project_code ?? "—"}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[220px]">{pr.project_site}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{pr.requested_by_name}</TableCell>
                    <TableCell>{pr.items_count}</TableCell>
                    <TableCell className="text-muted-foreground">{fmt(pr.required_by)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmt(pr.created_at)}</TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Button size="sm" variant="outline" onClick={() => openPr(pr)}>Add Specs →</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Spec enrichment dialog */}
      <Dialog open={!!selectedPr} onOpenChange={v => { if (!v) { setSelectedPr(null); setLineItems([]); } }}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-primary" />
              Add Material Specs — {selectedPr?.pr_number}
            </DialogTitle>
          </DialogHeader>

          {loadingItems ? (
            <div className="space-y-4 py-4">{[1,2].map(i => <Skeleton key={i} className="h-32 w-full" />)}</div>
          ) : (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Project: <span className="font-medium text-foreground">{selectedPr?.project_code ?? selectedPr?.project_site}</span>
                {" · "}Requested by: <span className="font-medium text-foreground">{selectedPr?.requested_by_name}</span>
              </p>

              {lineItems.map((li, idx) => (
                <Card key={li.id} className="border border-border">
                  <CardContent className="pt-4 pb-4 space-y-3">
                    {/* Item header */}
                    <div className="flex items-start gap-2">
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-primary">{idx + 1}</span>
                      </div>
                      <div>
                        <p className="font-semibold">{li.description}</p>
                        <p className="text-xs text-muted-foreground">{li.quantity} {li.unit}</p>
                        {li.specs && <p className="text-xs text-muted-foreground mt-0.5">Site notes: {li.specs}</p>}
                        {li.preferred_brands && li.preferred_brands.length > 0 && (
                          <p className="text-xs text-muted-foreground">Preferred brands: {li.preferred_brands.join(", ")}</p>
                        )}
                      </div>
                    </div>

                    {/* Spec inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-8">
                      <div className="space-y-1.5">
                        <Label className="text-xs flex items-center gap-1"><Tag className="h-3 w-3" /> Brand / Make</Label>
                        <Input
                          placeholder="e.g. Asian Paints, Pidilite, JSW…"
                          value={li.brand_make}
                          onChange={e => updateItem(li.id, "brand_make", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs flex items-center gap-1"><Palette className="h-3 w-3" /> Colour Code / Shade</Label>
                        <Input
                          placeholder="e.g. RAL 7035, Off White, #F5F5DC…"
                          value={li.colour_code}
                          onChange={e => updateItem(li.id, "colour_code", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs flex items-center gap-1"><FileText className="h-3 w-3" /> Additional Specifications</Label>
                        <Textarea
                          placeholder="Grade, size, finish, compliance standards, special requirements…"
                          value={li.design_notes}
                          onChange={e => updateItem(li.id, "design_notes", e.target.value)}
                          rows={2}
                          className="resize-none"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              <div className="flex justify-between items-center pt-2 border-t gap-3 flex-wrap">
                <p className="text-xs text-muted-foreground">Submitting will create RFQ(s) for the procurement team to review and send.</p>
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" onClick={() => { setSelectedPr(null); setLineItems([]); }}>Cancel</Button>
                  <Button onClick={submitSpecs} disabled={submitting}>
                    {submitting
                      ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</>
                      : "Save Specs & Create RFQ →"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
