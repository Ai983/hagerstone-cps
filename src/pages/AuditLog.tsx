import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { AlertTriangle, ChevronLeft, ChevronRight, Search, ShieldAlert } from "lucide-react";

type AuditRow = {
  id: number;
  logged_at: string | null;
  user_id: string | null;
  user_name: string | null;
  user_role: string | null;
  action_type: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_number: string | null;
  description: string | null;
  before_value: any;
  after_value: any;
  is_override: boolean | null;
  override_reason: string | null;
  severity: string | null;
  device_type: string | null;
};

const PAGE_SIZE = 50;

const actionBadgeCls: Record<string, string> = {
  CREATE: "bg-blue-100 text-blue-800",
  UPDATE: "bg-amber-100 text-amber-800",
  DELETE: "bg-red-100 text-red-800",
  APPROVE: "bg-green-100 text-green-800",
  REJECT: "bg-red-100 text-red-800",
  LOGIN: "bg-muted text-muted-foreground",
  OVERRIDE: "bg-orange-100 text-orange-800",
};

const severityBadgeCls: Record<string, string> = {
  info: "bg-muted text-muted-foreground",
  warning: "bg-amber-100 text-amber-800",
  critical: "bg-red-100 text-red-800",
};

const formatTimestamp = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
    ", " +
    dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
};

const truncate = (s: string | null, len: number) => {
  if (!s) return "—";
  return s.length <= len ? s : s.slice(0, len) + "...";
};

export default function AuditLog() {
  const { canViewAudit } = useAuth();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");

  const [actionTypes, setActionTypes] = useState<string[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);

  const [detailRow, setDetailRow] = useState<AuditRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchDistincts = async () => {
    const [actRes, entRes] = await Promise.all([
      supabase.from("cps_audit_log").select("action_type").limit(500),
      supabase.from("cps_audit_log").select("entity_type").limit(500),
    ]);
    const acts = new Set<string>();
    ((actRes.data ?? []) as any[]).forEach((r) => { if (r.action_type) acts.add(String(r.action_type)); });
    setActionTypes(Array.from(acts).sort());

    const ents = new Set<string>();
    ((entRes.data ?? []) as any[]).forEach((r) => { if (r.entity_type) ents.add(String(r.entity_type)); });
    setEntityTypes(Array.from(ents).sort());
  };

  const fetchRows = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("cps_audit_log")
        .select("*", { count: "exact" })
        .order("logged_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (actionFilter !== "all") query = query.eq("action_type", actionFilter);
      if (severityFilter !== "all") query = query.eq("severity", severityFilter);
      if (entityFilter !== "all") query = query.eq("entity_type", entityFilter);
      if (dateFrom) query = query.gte("logged_at", new Date(dateFrom).toISOString());
      if (dateTo) {
        const end = new Date(dateTo);
        end.setDate(end.getDate() + 1);
        query = query.lt("logged_at", end.toISOString());
      }

      const { data, error, count } = await query;
      if (error) throw error;

      let filtered = (data ?? []) as AuditRow[];
      const q = search.trim().toLowerCase();
      if (q) {
        filtered = filtered.filter((r) =>
          (r.description ?? "").toLowerCase().includes(q) ||
          (r.entity_number ?? "").toLowerCase().includes(q) ||
          (r.user_name ?? "").toLowerCase().includes(q),
        );
      }

      setRows(filtered);
      setTotalCount(count ?? 0);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load audit log");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canViewAudit) return;
    fetchDistincts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewAudit]);

  useEffect(() => {
    if (!canViewAudit) return;
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, actionFilter, severityFilter, entityFilter, dateFrom, dateTo, canViewAudit]);

  useEffect(() => {
    setPage(0);
  }, [actionFilter, severityFilter, entityFilter, dateFrom, dateTo, search]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  if (!canViewAudit) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <ShieldAlert className="h-10 w-10 text-destructive mx-auto" />
          <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
          <p className="text-muted-foreground text-sm">You do not have permission to view the audit log.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Audit Log</h1>
          <p className="text-muted-foreground text-sm mt-1">Complete immutable record of all system actions</p>
        </div>
        <Badge className="bg-muted text-muted-foreground border-border/80 text-xs border-0">
          Read Only — No edits or deletions permitted
        </Badge>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search description, entity, user..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Input type="date" className="w-40" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From date" />
        <Input type="date" className="w-40" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To date" />
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Action" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            {actionTypes.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severity</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Entity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Entities</SelectItem>
            {entityTypes.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table — desktop */}
      <div className="hidden lg:block">
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Override</TableHead>
                <TableHead className="text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                    No audit log entries found
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/30">
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTimestamp(r.logged_at)}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{r.user_name ?? "—"}</div>
                      {r.user_role && <Badge className="bg-muted text-muted-foreground border-0 text-[10px] mt-0.5">{r.user_role}</Badge>}
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs border-0 ${actionBadgeCls[String(r.action_type ?? "").toUpperCase()] ?? "bg-muted text-muted-foreground"}`}>
                        {r.action_type ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">{r.entity_type ?? "—"}</div>
                      {r.entity_number && <div className="text-xs font-mono text-primary">{r.entity_number}</div>}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-sm cursor-default">{truncate(r.description, 60)}</span>
                        </TooltipTrigger>
                        {(r.description ?? "").length > 60 && (
                          <TooltipContent className="max-w-xs"><p className="text-xs">{r.description}</p></TooltipContent>
                        )}
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs border-0 ${severityBadgeCls[String(r.severity ?? "info")] ?? severityBadgeCls.info}`}>
                        {r.severity ?? "info"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.is_override ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge className="bg-red-100 text-red-800 border-0 text-xs cursor-default">
                              <AlertTriangle className="h-3 w-3 mr-1" />Override
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs"><p className="text-xs">{r.override_reason ?? "No reason given"}</p></TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => { setDetailRow(r); setDetailOpen(true); }}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </div>

      {/* Cards — mobile */}
      <div className="lg:hidden space-y-2">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No audit log entries found</div>
        ) : (
          rows.map((r) => (
            <Card key={r.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <Badge className={`text-xs border-0 ${actionBadgeCls[String(r.action_type ?? "").toUpperCase()] ?? "bg-muted text-muted-foreground"}`}>
                    {r.action_type ?? "—"}
                  </Badge>
                  <div className="text-xs font-medium">{r.user_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{truncate(r.description, 80)}</div>
                </div>
                <div className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">{formatTimestamp(r.logged_at)}</div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Pagination */}
      {!loading && totalCount > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <span className="text-sm text-muted-foreground">Page {page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detailRow?.action_type ?? "—"} — {detailRow?.entity_number ?? detailRow?.entity_type ?? "—"}
            </DialogTitle>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">User:</span> {detailRow.user_name ?? "—"}</div>
                <div><span className="text-muted-foreground">Role:</span> {detailRow.user_role ?? "—"}</div>
                <div><span className="text-muted-foreground">Timestamp:</span> {formatTimestamp(detailRow.logged_at)}</div>
                <div><span className="text-muted-foreground">Severity:</span> {detailRow.severity ?? "info"}</div>
              </div>
              <div className="text-sm">{detailRow.description ?? "—"}</div>

              {detailRow.before_value && (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-muted-foreground">Before:</div>
                  <pre className="bg-muted rounded-md p-3 text-xs overflow-auto max-h-48">
                    {JSON.stringify(detailRow.before_value, null, 2)}
                  </pre>
                </div>
              )}
              {detailRow.after_value && (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-muted-foreground">After:</div>
                  <pre className="bg-muted rounded-md p-3 text-xs overflow-auto max-h-48">
                    {JSON.stringify(detailRow.after_value, null, 2)}
                  </pre>
                </div>
              )}

              {detailRow.is_override && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">
                  <span className="font-medium">Override Reason:</span> {detailRow.override_reason ?? "No reason given"}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
