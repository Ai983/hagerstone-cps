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

import { ShieldCheck, ShieldX, ShieldAlert, ChevronDown, ChevronRight, Package } from "lucide-react";

type OverrideStatus = "requested" | "allowed" | "denied";

type LineItem = {
  description: string;
  quantity: number | null;
  unit: string | null;
  brand_make: string | null;
  preferred_brands: string | null;
  specs: string | null;
};

type OverrideRow = {
  id: string;
  rfq_number: string;
  title: string | null;
  target_category: string | null;
  deadline: string | null;
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
  min_quotes_override_attachment_url: string | null;
  requestor_name: string | null;
  decided_by_name: string | null;
  approved_count: number;
  suppliers_invited: number;
  line_items: LineItem[];
};

const formatDateTime = (d: string | null | undefined) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(d);
  }
};

const formatQty = (q: number | null) => {
  if (q === null || q === undefined) return "—";
  const n = Number(q);
  if (Number.isNaN(n)) return String(q);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.00$/, "");
};

const MaterialsSummary: React.FC<{ items: LineItem[] }> = ({ items }) => {
  if (!items || items.length === 0) {
    return <span className="text-muted-foreground">No materials listed</span>;
  }
  const preview = items.slice(0, 2);
  const remaining = items.length - preview.length;
  return (
    <div className="space-y-0.5">
      {preview.map((li, idx) => (
        <div key={idx} className="truncate" title={li.description}>
          <span className="font-medium">{li.description || "—"}</span>
          {li.quantity !== null && (
            <span className="text-muted-foreground"> · {formatQty(li.quantity)}{li.unit ? ` ${li.unit}` : ""}</span>
          )}
        </div>
      ))}
      {remaining > 0 && (
        <div className="text-[11px] text-muted-foreground">+{remaining} more item{remaining > 1 ? "s" : ""}</div>
      )}
    </div>
  );
};

const ExpandedDetails: React.FC<{ row: OverrideRow }> = ({ row }) => {
  return (
    <div className="bg-muted/30 border-t px-4 py-3 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div>
          <div className="text-muted-foreground">RFQ deadline</div>
          <div className="font-medium">{formatDateTime(row.deadline)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Category</div>
          <div className="font-medium">{row.target_category ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Suppliers invited</div>
          <div className="font-medium">{row.suppliers_invited}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Approved quotes</div>
          <div className="font-medium">{row.approved_count} / 3</div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-1.5 text-xs font-semibold mb-1.5">
          <Package className="h-3.5 w-3.5" />
          Materials in this RFQ ({row.line_items.length})
        </div>
        {row.line_items.length === 0 ? (
          <div className="text-xs text-muted-foreground">No line items found for this PR.</div>
        ) : (
          <div className="rounded border bg-background overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px] w-10">#</TableHead>
                  <TableHead className="text-[11px]">Material / Description</TableHead>
                  <TableHead className="text-[11px] w-24">Qty</TableHead>
                  <TableHead className="text-[11px] w-20">Unit</TableHead>
                  <TableHead className="text-[11px]">Brand / Make</TableHead>
                  <TableHead className="text-[11px]">Specs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {row.line_items.map((li, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="text-xs font-medium">{li.description || "—"}</TableCell>
                    <TableCell className="text-xs">{formatQty(li.quantity)}</TableCell>
                    <TableCell className="text-xs">{li.unit ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {li.brand_make || li.preferred_brands || "—"}
                    </TableCell>
                    <TableCell className="text-xs whitespace-pre-wrap max-w-[260px]">
                      {li.specs || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
};

export default function AdminOverrides() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"pending" | "decided">("pending");
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

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
          "id,rfq_number,title,target_category,deadline,pr_id,min_quotes_override_status,min_quotes_override_reason,min_quotes_override_requested_by,min_quotes_override_requested_at,min_quotes_override_allowed_by,min_quotes_override_allowed_at,min_quotes_override_admin_note,min_quotes_override_attachment_url"
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

      // 5) Suppliers invited per RFQ
      const { data: rfqSuppliers } = await supabase
        .from("cps_rfq_suppliers")
        .select("rfq_id")
        .in("rfq_id", rfqIds);
      const invitedByRfq: Record<string, number> = {};
      (rfqSuppliers ?? []).forEach((row: any) => {
        invitedByRfq[row.rfq_id] = (invitedByRfq[row.rfq_id] ?? 0) + 1;
      });

      // 6) PR line items (materials) for all relevant PRs
      const lineItemsByPr: Record<string, LineItem[]> = {};
      if (prIds.length) {
        const { data: lineRows } = await supabase
          .from("cps_pr_line_items")
          .select("pr_id,description,quantity,unit,brand_make,preferred_brands,specs,sort_order")
          .in("pr_id", prIds)
          .order("sort_order", { ascending: true });
        (lineRows ?? []).forEach((li: any) => {
          const key = String(li.pr_id);
          if (!lineItemsByPr[key]) lineItemsByPr[key] = [];
          lineItemsByPr[key].push({
            description: li.description ?? "",
            quantity: li.quantity ?? null,
            unit: li.unit ?? null,
            brand_make: li.brand_make ?? null,
            preferred_brands: li.preferred_brands ?? null,
            specs: li.specs ?? null,
          });
        });
      }

      const prById: Record<string, any> = {};
      (prs ?? []).forEach((p: any) => { prById[p.id] = p; });
      const userById: Record<string, string> = {};
      (users ?? []).forEach((u: any) => { userById[u.id] = u.name ?? "—"; });

      const merged: OverrideRow[] = rfqRows.map((r) => ({
        id: r.id,
        rfq_number: r.rfq_number,
        title: r.title,
        target_category: r.target_category ?? null,
        deadline: r.deadline ?? null,
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
        min_quotes_override_attachment_url: (r as any).min_quotes_override_attachment_url ?? null,
        requestor_name: r.min_quotes_override_requested_by ? userById[r.min_quotes_override_requested_by] ?? null : null,
        decided_by_name: r.min_quotes_override_allowed_by ? userById[r.min_quotes_override_allowed_by] ?? null : null,
        approved_count: approvedByRfq[r.id] ?? 0,
        suppliers_invited: invitedByRfq[r.id] ?? 0,
        line_items: r.pr_id ? (lineItemsByPr[r.pr_id] ?? []) : [],
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
            <CardDescription>Override requests page sirf IT team dekh sakti hai.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => navigate("/dashboard")}>Go to Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex items-start justify-between gap-2 lg:gap-4 flex-wrap">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 lg:h-6 lg:w-6 text-primary" />
            Override Requests
          </h1>
          <p className="text-xs lg:text-sm text-muted-foreground">
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
                <>
                  {/* Mobile cards */}
                  <div className="lg:hidden divide-y divide-border">
                    {pending.map((r) => {
                      const isOpen = !!expandedRows[r.id];
                      return (
                        <div key={r.id} className="p-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs text-primary font-semibold">{r.rfq_number}</span>
                            <Badge className={`text-[10px] border-0 ${r.approved_count >= 3 ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                              {r.approved_count}/3 quotes
                            </Badge>
                          </div>
                          {r.pr_number && <div className="text-[11px] text-muted-foreground">{r.pr_number}</div>}
                          {r.pr_project_code && <div className="text-xs font-medium">{r.pr_project_code}</div>}
                          {r.pr_project_site && <div className="text-[11px] text-muted-foreground">{r.pr_project_site}</div>}
                          <div className="text-[11px] text-muted-foreground">By {r.requestor_name ?? "—"} · {formatDateTime(r.min_quotes_override_requested_at)}</div>

                          <div className="rounded border bg-muted/30 p-2 text-xs">
                            <div className="flex items-center gap-1.5 font-semibold mb-1">
                              <Package className="h-3.5 w-3.5" />
                              Materials ({r.line_items.length})
                            </div>
                            <MaterialsSummary items={r.line_items} />
                            {r.line_items.length > 2 && (
                              <button
                                type="button"
                                className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary"
                                onClick={() => toggleExpand(r.id)}
                              >
                                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                {isOpen ? "Hide all materials" : "Show all materials"}
                              </button>
                            )}
                          </div>

                          {r.min_quotes_override_reason && (
                            <div className="text-xs whitespace-pre-wrap"><span className="text-muted-foreground">Reason:</span> {r.min_quotes_override_reason}</div>
                          )}
                          {r.min_quotes_override_attachment_url && (
                            <a
                              href={r.min_quotes_override_attachment_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary underline"
                            >
                              📎 View attachment
                            </a>
                          )}

                          {isOpen && (
                            <div className="-mx-3">
                              <ExpandedDetails row={r} />
                            </div>
                          )}

                          <div className="flex items-center gap-2 pt-1">
                            <Button size="sm" className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white h-8" onClick={() => openDecide(r, "allow")}>
                              Allow
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive/40 hover:bg-destructive/10 h-8" onClick={() => openDecide(r, "deny")}>
                              Deny
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden lg:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead>RFQ / PR</TableHead>
                          <TableHead>Project</TableHead>
                          <TableHead>Materials</TableHead>
                          <TableHead>Requestor</TableHead>
                          <TableHead>Quotes</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Requested At</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pending.map((r) => {
                          const isOpen = !!expandedRows[r.id];
                          return (
                            <React.Fragment key={r.id}>
                              <TableRow className="hover:bg-muted/30 cursor-pointer" onClick={() => toggleExpand(r.id)}>
                                <TableCell className="align-top pt-3">
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); }}
                                    aria-label={isOpen ? "Collapse" : "Expand"}
                                  >
                                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  </button>
                                </TableCell>
                                <TableCell className="align-top">
                                  <div className="font-mono text-xs text-primary font-semibold">{r.rfq_number}</div>
                                  {r.pr_number && <div className="text-[11px] text-muted-foreground">{r.pr_number}</div>}
                                  {r.title && <div className="text-xs mt-0.5 max-w-[220px] truncate" title={r.title}>{r.title}</div>}
                                  {r.target_category && <div className="text-[10px] mt-0.5 inline-block bg-muted px-1.5 py-0.5 rounded">{r.target_category}</div>}
                                </TableCell>
                                <TableCell className="text-xs align-top">
                                  {r.pr_project_code && <div className="font-medium">{r.pr_project_code}</div>}
                                  {r.pr_project_site && <div className="text-muted-foreground">{r.pr_project_site}</div>}
                                </TableCell>
                                <TableCell className="text-xs align-top max-w-[260px]">
                                  <MaterialsSummary items={r.line_items} />
                                </TableCell>
                                <TableCell className="text-xs align-top">{r.requestor_name ?? "—"}</TableCell>
                                <TableCell className="align-top">
                                  <Badge className={`text-xs border-0 ${r.approved_count >= 3 ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                                    {r.approved_count}/3
                                  </Badge>
                                  <div className="text-[10px] text-muted-foreground mt-1">{r.suppliers_invited} invited</div>
                                </TableCell>
                                <TableCell className="text-xs max-w-[260px] whitespace-pre-wrap align-top">
                                  <div>{r.min_quotes_override_reason ?? "—"}</div>
                                  {r.min_quotes_override_attachment_url && (
                                    <a
                                      href={r.min_quotes_override_attachment_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="mt-1 inline-flex items-center gap-1 text-primary underline hover:text-primary/80"
                                    >
                                      📎 View attachment
                                    </a>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap align-top">{formatDateTime(r.min_quotes_override_requested_at)}</TableCell>
                                <TableCell className="text-right align-top" onClick={(e) => e.stopPropagation()}>
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
                              {isOpen && (
                                <TableRow>
                                  <TableCell colSpan={9} className="p-0">
                                    <ExpandedDetails row={r} />
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
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
                <>
                  {/* Mobile cards */}
                  <div className="lg:hidden divide-y divide-border">
                    {decided.map((r) => {
                      const isOpen = !!expandedRows[r.id];
                      return (
                        <div key={r.id} className="p-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs text-primary font-semibold">{r.rfq_number}</span>
                            {r.min_quotes_override_status === "allowed" ? (
                              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 border text-[10px]">✓ Allowed</Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-800 border-red-300 border text-[10px]">✗ Denied</Badge>
                            )}
                          </div>
                          {r.pr_number && <div className="text-[11px] text-muted-foreground">{r.pr_number}</div>}
                          {r.pr_project_code && <div className="text-xs font-medium">{r.pr_project_code}</div>}
                          <div className="text-[11px] text-muted-foreground">
                            By {r.requestor_name ?? "—"} → Decided by {r.decided_by_name ?? "—"}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{formatDateTime(r.min_quotes_override_allowed_at)}</div>

                          <div className="rounded border bg-muted/30 p-2 text-xs">
                            <div className="flex items-center gap-1.5 font-semibold mb-1">
                              <Package className="h-3.5 w-3.5" />
                              Materials ({r.line_items.length})
                            </div>
                            <MaterialsSummary items={r.line_items} />
                            {r.line_items.length > 2 && (
                              <button
                                type="button"
                                className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary"
                                onClick={() => toggleExpand(r.id)}
                              >
                                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                {isOpen ? "Hide all materials" : "Show all materials"}
                              </button>
                            )}
                          </div>

                          {r.min_quotes_override_reason && <div className="text-xs whitespace-pre-wrap"><span className="text-muted-foreground">Procurement:</span> {r.min_quotes_override_reason}</div>}
                          {r.min_quotes_override_admin_note && <div className="text-xs whitespace-pre-wrap"><span className="text-muted-foreground">IT note:</span> {r.min_quotes_override_admin_note}</div>}
                          {r.min_quotes_override_attachment_url && (
                            <a
                              href={r.min_quotes_override_attachment_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary underline"
                            >
                              📎 View attachment
                            </a>
                          )}

                          {isOpen && (
                            <div className="-mx-3">
                              <ExpandedDetails row={r} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden lg:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead>RFQ / PR</TableHead>
                          <TableHead>Materials</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Requested By</TableHead>
                          <TableHead>Decided By</TableHead>
                          <TableHead>Decided At</TableHead>
                          <TableHead>Reason / Note</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {decided.map((r) => {
                          const isOpen = !!expandedRows[r.id];
                          return (
                            <React.Fragment key={r.id}>
                              <TableRow className="hover:bg-muted/30 cursor-pointer" onClick={() => toggleExpand(r.id)}>
                                <TableCell className="align-top pt-3">
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); }}
                                    aria-label={isOpen ? "Collapse" : "Expand"}
                                  >
                                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  </button>
                                </TableCell>
                                <TableCell className="align-top">
                                  <div className="font-mono text-xs text-primary font-semibold">{r.rfq_number}</div>
                                  {r.pr_number && <div className="text-[11px] text-muted-foreground">{r.pr_number}</div>}
                                  {r.pr_project_code && <div className="text-[11px] text-muted-foreground">{r.pr_project_code}</div>}
                                </TableCell>
                                <TableCell className="text-xs align-top max-w-[260px]">
                                  <MaterialsSummary items={r.line_items} />
                                </TableCell>
                                <TableCell className="align-top">
                                  {r.min_quotes_override_status === "allowed" ? (
                                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 border text-xs">✓ Allowed</Badge>
                                  ) : (
                                    <Badge className="bg-red-100 text-red-800 border-red-300 border text-xs">✗ Denied</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs align-top">{r.requestor_name ?? "—"}</TableCell>
                                <TableCell className="text-xs align-top">{r.decided_by_name ?? "—"}</TableCell>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap align-top">{formatDateTime(r.min_quotes_override_allowed_at)}</TableCell>
                                <TableCell className="text-xs max-w-[320px] whitespace-pre-wrap align-top">
                                  {r.min_quotes_override_reason && <div><span className="text-muted-foreground">Procurement:</span> {r.min_quotes_override_reason}</div>}
                                  {r.min_quotes_override_admin_note && <div className="mt-1"><span className="text-muted-foreground">IT team note:</span> {r.min_quotes_override_admin_note}</div>}
                                  {r.min_quotes_override_attachment_url && (
                                    <a
                                      href={r.min_quotes_override_attachment_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="mt-1 inline-flex items-center gap-1 text-primary underline hover:text-primary/80"
                                    >
                                      📎 View attachment
                                    </a>
                                  )}
                                </TableCell>
                              </TableRow>
                              {isOpen && (
                                <TableRow>
                                  <TableCell colSpan={8} className="p-0">
                                    <ExpandedDetails row={r} />
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
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
          {decideRow?.min_quotes_override_attachment_url && (
            <div className="text-xs bg-muted/50 border rounded p-2 space-y-2">
              <div className="text-muted-foreground">Attachment:</div>
              {/\.(pdf)$/i.test(decideRow.min_quotes_override_attachment_url) ? (
                <a href={decideRow.min_quotes_override_attachment_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                  📄 Open PDF
                </a>
              ) : (
                <a href={decideRow.min_quotes_override_attachment_url} target="_blank" rel="noopener noreferrer" className="block">
                  <img
                    src={decideRow.min_quotes_override_attachment_url}
                    alt="Override attachment"
                    className="max-h-64 w-auto rounded border"
                  />
                </a>
              )}
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
