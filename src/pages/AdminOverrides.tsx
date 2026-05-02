import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

import { ShieldCheck, ShieldX, ShieldAlert } from "lucide-react";

type OverrideStatus = "requested" | "allowed" | "denied";

type OverrideRow = {
  id: string;
  rfq_number: string;
  title: string | null;
  pr_id: string | null;
  pr_number: string | null;
  pr_project_site: string | null;
  pr_project_code: string | null;
  min_quotes_override_status: OverrideStatus;
  min_quotes_override_reason: string | null;
  min_quotes_override_requested_by: string | null;
  min_quotes_override_requested_at: string | null;
  min_quotes_override_allowed_by: string | null;
  min_quotes_override_allowed_at: string | null;
  min_quotes_override_admin_note: string | null;
  requestor_name: string | null;
  decided_by_name: string | null;
  approved_count: number;
};

const formatDateTime = (d: string | null | undefined) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(d);
  }
};

export default function AdminOverrides() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"pending" | "decided">("pending");

  // Decision dialog state
  const [decideRow, setDecideRow] = useState<OverrideRow | null>(null);
  const [decideAction, setDecideAction] = useState<"allow" | "deny">("allow");
  const [adminNote, setAdminNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isItHead = user?.role === "it_head";

  useEffect(() => {
    if (user && !isItHead) {
      // Procurement / other roles shouldn't see this page
      return;
    }
    if (user) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      // 1) RFQs with any non-'none' override status
      const { data: rfqs, error: rfqErr } = await supabase
        .from("cps_rfqs")
        .select(
          "id,rfq_number,title,pr_id,min_quotes_override_status,min_quotes_override_reason,min_quotes_override_requested_by,min_quotes_override_requested_at,min_quotes_override_allowed_by,min_quotes_override_allowed_at,min_quotes_override_admin_note"
        )
        .in("min_quotes_override_status", ["requested", "allowed", "denied"])
        .order("min_quotes_override_requested_at", { ascending: false });
      if (rfqErr) throw rfqErr;

      const rfqRows = (rfqs ?? []) as any[];
      if (rfqRows.length === 0) {
        setRows([]);
        return;
      }

      const rfqIds = rfqRows.map((r) => r.id);
      const prIds = Array.from(new Set(rfqRows.map((r) => r.pr_id).filter(Boolean)));
      const userIds = Array.from(
        new Set(
          rfqRows
            .flatMap((r) => [r.min_quotes_override_requested_by, r.min_quotes_override_allowed_by])
            .filter(Boolean) as string[]
        )
      );

      // 2) PRs (project info)
      const { data: prs } = prIds.length
        ? await supabase
            .from("cps_purchase_requisitions")
            .select("id, pr_number, project_site, project_code")
            .in("id", prIds)
        : { data: [] as any[] };

      // 3) Users (requestor + decider names)
      const { data: users } = userIds.length
        ? await supabase.from("cps_users").select("id, name").in("id", userIds)
        : { data: [] as any[] };

      // 4) Approved quote counts per RFQ
      const { data: quotes } = await supabase
        .from("cps_quotes")
        .select("rfq_id")
        .in("rfq_id", rfqIds)
        .eq("parse_status", "approved");
      const approvedByRfq: Record<string, number> = {};
      (quotes ?? []).forEach((q: any) => {
        approvedByRfq[q.rfq_id] = (approvedByRfq[q.rfq_id] ?? 0) + 1;
      });

      const prById: Record<string, any> = {};
      (prs ?? []).forEach((p: any) => { prById[p.id] = p; });
      const userById: Record<string, string> = {};
      (users ?? []).forEach((u: any) => { userById[u.id] = u.name ?? "—"; });

      const merged: OverrideRow[] = rfqRows.map((r) => ({
        id: r.id,
        rfq_number: r.rfq_number,
        title: r.title,
        pr_id: r.pr_id,
        pr_number: prById[r.pr_id]?.pr_number ?? null,
        pr_project_site: prById[r.pr_id]?.project_site ?? null,
        pr_project_code: prById[r.pr_id]?.project_code ?? null,
        min_quotes_override_status: r.min_quotes_override_status,
        min_quotes_override_reason: r.min_quotes_override_reason,
        min_quotes_override_requested_by: r.min_quotes_override_requested_by,
        min_quotes_override_requested_at: r.min_quotes_override_requested_at,
        min_quotes_override_allowed_by: r.min_quotes_override_allowed_by,
        min_quotes_override_allowed_at: r.min_quotes_override_allowed_at,
        min_quotes_override_admin_note: r.min_quotes_override_admin_note,
        requestor_name: r.min_quotes_override_requested_by ? userById[r.min_quotes_override_requested_by] ?? null : null,
        decided_by_name: r.min_quotes_override_allowed_by ? userById[r.min_quotes_override_allowed_by] ?? null : null,
        approved_count: approvedByRfq[r.id] ?? 0,
      }));

      setRows(merged);
    } catch (e: any) {
      toast.error(e?.message ?? "Override requests load nahi ho payi");
    } finally {
      setLoading(false);
    }
  };

  const pending = useMemo(() => rows.filter((r) => r.min_quotes_override_status === "requested"), [rows]);
  const decided = useMemo(
    () => rows.filter((r) => r.min_quotes_override_status === "allowed" || r.min_quotes_override_status === "denied"),
    [rows]
  );

  const openDecide = (row: OverrideRow, action: "allow" | "deny") => {
    setDecideRow(row);
    setDecideAction(action);
    setAdminNote("");
  };

  const submitDecision = async () => {
    if (!decideRow || !user) return;
    setSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const newStatus: OverrideStatus = decideAction === "allow" ? "allowed" : "denied";
      const { error } = await supabase
        .from("cps_rfqs")
        .update({
          min_quotes_override_status: newStatus,
          min_quotes_override_allowed_by: user.id,
          min_quotes_override_allowed_at: nowIso,
          min_quotes_override_admin_note: adminNote.trim() || null,
        })
        .eq("id", decideRow.id);
      if (error) throw error;

      await supabase.from("cps_audit_log").insert({
        user_id: user.id,
        user_name: user.name,
        user_role: user.role,
        action_type: decideAction === "allow" ? "RFQ_OVERRIDE_ALLOWED" : "RFQ_OVERRIDE_DENIED",
        entity_type: "cps_rfqs",
        entity_id: decideRow.id,
        entity_number: decideRow.rfq_number,
        description: `Override ${newStatus} for ${decideRow.rfq_number} by ${user.name ?? user.email}.${adminNote.trim() ? ` Note: ${adminNote.trim()}` : ""}`,
        severity: decideAction === "allow" ? "info" : "warning",
        logged_at: nowIso,
      });

      toast.success(`${decideRow.rfq_number} — ${newStatus === "allowed" ? "Allow" : "Deny"} ho gaya`);
      setDecideRow(null);
      await fetchAll();
    } catch (e: any) {
      toast.error(e?.message ?? "Decision save nahi hua");
    } finally {
      setSubmitting(false);
    }
  };

  if (user && !isItHead) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-amber-600" /> Access Restricted</CardTitle>
            <CardDescription>Override requests page sirf IT head dekh sakte hain.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => navigate("/dashboard")}>Go to Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Override Requests
          </h1>
          <p className="text-sm text-muted-foreground">
            Procurement team se aaye hue requests jahan 3 vendors nahi mil paye. Sir ka approval lene ke baad allow ya deny karo.
          </p>
        </div>
        <Badge className="bg-amber-100 text-amber-900 border-amber-300 border">
          {pending.length} pending
        </Badge>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "pending" | "decided")}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="decided">Decided ({decided.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (<Skeleton key={i} className="h-16 w-full rounded-lg" />))}
                </div>
              ) : pending.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  Koi pending override request nahi hai.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>RFQ / PR</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Requestor</TableHead>
                      <TableHead>Approved Quotes</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Requested At</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-mono text-xs text-primary font-semibold">{r.rfq_number}</div>
                          {r.pr_number && <div className="text-[11px] text-muted-foreground">{r.pr_number}</div>}
                          {r.title && <div className="text-xs mt-0.5 max-w-[220px] truncate" title={r.title}>{r.title}</div>}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.pr_project_code && <div className="font-medium">{r.pr_project_code}</div>}
                          {r.pr_project_site && <div className="text-muted-foreground">{r.pr_project_site}</div>}
                        </TableCell>
                        <TableCell className="text-xs">{r.requestor_name ?? "—"}</TableCell>
                        <TableCell>
                          <Badge className={`text-xs border-0 ${r.approved_count >= 3 ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                            {r.approved_count}/3
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs max-w-[280px] whitespace-pre-wrap">{r.min_quotes_override_reason ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(r.min_quotes_override_requested_at)}</TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex gap-1">
                            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => openDecide(r, "allow")}>
                              Allow
                            </Button>
                            <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => openDecide(r, "deny")}>
                              Deny
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="decided" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (<Skeleton key={i} className="h-16 w-full rounded-lg" />))}
                </div>
              ) : decided.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  Abhi tak koi decision nahi liya gaya.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>RFQ / PR</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Decided By</TableHead>
                      <TableHead>Decided At</TableHead>
                      <TableHead>Reason / Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {decided.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-mono text-xs text-primary font-semibold">{r.rfq_number}</div>
                          {r.pr_number && <div className="text-[11px] text-muted-foreground">{r.pr_number}</div>}
                        </TableCell>
                        <TableCell>
                          {r.min_quotes_override_status === "allowed" ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 border text-xs">✓ Allowed</Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-800 border-red-300 border text-xs">✗ Denied</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{r.decided_by_name ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(r.min_quotes_override_allowed_at)}</TableCell>
                        <TableCell className="text-xs max-w-[320px] whitespace-pre-wrap">
                          {r.min_quotes_override_reason && <div><span className="text-muted-foreground">Procurement:</span> {r.min_quotes_override_reason}</div>}
                          {r.min_quotes_override_admin_note && <div className="mt-1"><span className="text-muted-foreground">IT note:</span> {r.min_quotes_override_admin_note}</div>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Decision dialog */}
      <Dialog open={!!decideRow} onOpenChange={(o) => { if (!o && !submitting) setDecideRow(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decideAction === "allow" ? "Allow Override" : "Deny Override"} — {decideRow?.rfq_number}
            </DialogTitle>
            <DialogDescription>
              {decideAction === "allow"
                ? "Sir ka approval mil gaya hai? Note add karo (optional)."
                : "Override deny kar rahe ho? Reason note me likho (optional)."}
            </DialogDescription>
          </DialogHeader>
          {decideRow?.min_quotes_override_reason && (
            <div className="text-xs bg-muted/50 border rounded p-2">
              <div className="text-muted-foreground mb-0.5">Procurement reason:</div>
              <div className="whitespace-pre-wrap">{decideRow.min_quotes_override_reason}</div>
            </div>
          )}
          <div className="space-y-2 py-1">
            <Label htmlFor="admin-note" className="text-xs">Admin note (optional)</Label>
            <Textarea
              id="admin-note"
              rows={3}
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              placeholder={decideAction === "allow" ? "Sir confirmed verbally on …" : "Reason for denial …"}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecideRow(null)} disabled={submitting}>Cancel</Button>
            <Button
              onClick={submitDecision}
              disabled={submitting}
              className={decideAction === "allow" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-destructive hover:bg-destructive/90 text-destructive-foreground"}
            >
              {submitting ? "Saving…" : (decideAction === "allow" ? "Confirm Allow" : "Confirm Deny")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
