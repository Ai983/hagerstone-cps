// Task Board — the Project Coordinator's follow-up screen.
//
// Structured like KanbanBoard.tsx: no drag-and-drop library (none is installed), a
// horizontally scrollable strip of fixed-width columns, each card a <button> that
// opens a detail dialog. Status moves happen through explicit action buttons, so
// every transition can be audited and notified.
//
// "Overdue" is a derived column, not a stored status — an overdue task appears there
// instead of in Assigned/In Progress.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  CheckCircle2, ClipboardList, MessageSquare, Paperclip,
  Plus, RefreshCw, RotateCcw, Search, XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AssignTaskDialog } from "@/components/tasks/AssignTaskDialog";
import { openSignedFile } from "@/lib/storageUrl";
import {
  PRIORITY_META, TASK_BUCKET, dueBadge, fireTaskWebhook, isOverdue, notifyUser,
  resolveWhatsapp, todayIso, type SiteTask, type TaskAudience, type TaskUpdate,
} from "@/lib/tasks";

type ColumnKey = "overdue" | "assigned" | "in_progress" | "submitted" | "completed";

const COLUMNS: Array<{ key: ColumnKey; label: string; desc: string; accent: string }> = [
  { key: "overdue",     label: "Overdue",       desc: "Deadline nikal gayi",       accent: "border-t-red-500" },
  { key: "assigned",    label: "Assigned",      desc: "Abhi shuru nahi hua",       accent: "border-t-muted-foreground/40" },
  { key: "in_progress", label: "In Progress",   desc: "Kaam chal raha hai",        accent: "border-t-blue-500" },
  { key: "submitted",   label: "Needs Review",  desc: "Poora bataya, verify karo", accent: "border-t-amber-500" },
  { key: "completed",   label: "Completed",     desc: "Approve ho gaya",           accent: "border-t-green-600" },
];

export default function TaskBoard() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tasks, setTasks] = useState<SiteTask[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [audienceFilter, setAudienceFilter] = useState<TaskAudience | "all">("all");

  const [assignOpen, setAssignOpen] = useState(false);
  const [detail, setDetail] = useState<SiteTask | null>(null);
  const [updates, setUpdates] = useState<TaskUpdate[]>([]);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [note, setNote] = useState("");
  const [acting, setActing] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRes, projRes] = await Promise.all([
        supabase.from("cps_site_tasks").select("*").order("due_date", { ascending: true }),
        supabase.from("cps_projects").select("name").eq("active", true),
      ]);
      const rows = (taskRes.data ?? []) as SiteTask[];
      setTasks(rows);
      setProjects(
        Array.from(new Set((projRes.data ?? []).map((r: { name: string | null }) => (r.name ?? "").trim()).filter(Boolean))).sort(),
      );

      const ids = Array.from(new Set(rows.flatMap(t => [t.assigned_to, t.assigned_by]).filter(Boolean))) as string[];
      if (ids.length) {
        const { data: users } = await supabase.from("cps_users").select("id,name,email").in("id", ids);
        const map: Record<string, string> = {};
        (users ?? []).forEach((u: { id: string; name: string | null; email: string }) => {
          map[u.id] = u.name ?? u.email;
        });
        setUserNames(map);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Deep link from the dashboard / a notification: /tasks?task=<id>
  const deepLinkId = searchParams.get("task");
  useEffect(() => {
    if (!deepLinkId || !tasks.length) return;
    const t = tasks.find(x => x.id === deepLinkId);
    if (t) openDetail(t);
  }, [deepLinkId, tasks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter(t => {
      if (t.status === "cancelled") return false;
      if (projectFilter !== "all" && t.project_code !== projectFilter) return false;
      if (audienceFilter !== "all" && t.audience !== audienceFilter) return false;
      if (!q) return true;
      return [t.task_number, t.title, t.project_code, userNames[t.assigned_to]]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
    });
  }, [tasks, search, projectFilter, audienceFilter, userNames]);

  const grouped = useMemo(() => {
    const g: Record<ColumnKey, SiteTask[]> = {
      overdue: [], assigned: [], in_progress: [], submitted: [], completed: [],
    };
    filtered.forEach(t => {
      if (isOverdue(t)) g.overdue.push(t);
      else if (t.status === "assigned") g.assigned.push(t);
      else if (t.status === "in_progress") g.in_progress.push(t);
      else if (t.status === "submitted") g.submitted.push(t);
      else if (t.status === "completed") g.completed.push(t);
    });
    return g;
  }, [filtered]);

  const stats = useMemo(() => {
    const open = filtered.filter(t => t.status !== "completed");
    const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndIso = weekEnd.toISOString().slice(0, 10);
    return {
      open: open.length,
      overdue: grouped.overdue.length,
      dueWeek: open.filter(t => t.due_date >= todayIso() && t.due_date <= weekEndIso).length,
      review: grouped.submitted.length,
    };
  }, [filtered, grouped]);

  const openDetail = async (t: SiteTask) => {
    setDetail(t);
    setNote("");
    setUpdatesLoading(true);
    const { data } = await supabase
      .from("cps_site_task_updates").select("*").eq("task_id", t.id)
      .order("created_at", { ascending: false });
    setUpdates((data ?? []) as TaskUpdate[]);
    setUpdatesLoading(false);
  };

  const closeDetail = () => {
    setDetail(null);
    setUpdates([]);
    if (deepLinkId) { searchParams.delete("task"); setSearchParams(searchParams, { replace: true }); }
  };

  const audit = async (task: SiteTask, actionType: string, description: string) => {
    await supabase.from("cps_audit_log").insert({
      action_type: actionType,
      entity_type: "task",
      entity_id: task.id,
      entity_number: task.task_number,
      description,
      user_id: user?.id ?? null,
      user_name: user?.name ?? null,
      user_role: user?.role ?? null,
    });
  };

  const approve = async () => {
    if (!detail) return;
    setActing(true);
    try {
      const { error } = await supabase.from("cps_site_tasks").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        reviewed_by: user?.id ?? null,
        review_note: note.trim() || null,
        updated_at: new Date().toISOString(),
      }).eq("id", detail.id);
      if (error) throw error;

      await audit(detail, "TASK_APPROVED", `Task "${detail.title}" approved${note.trim() ? `: ${note.trim()}` : ""}`);
      await notifyUser({
        userId: detail.assigned_to,
        type: "task_approved",
        title: `Kaam approve ho gaya: ${detail.title}`,
        body: note.trim() || undefined,
        link: `/my-work?task=${detail.id}`,
        entityType: "task",
        entityId: detail.id,
      });
      toast.success("Task complete mark ho gaya");
      closeDetail();
      fetchAll();
    } catch (e) {
      toast.error("Approve fail: " + (e as Error).message);
    } finally { setActing(false); }
  };

  const reopen = async () => {
    if (!detail) return;
    if (!note.trim()) { toast.error("Reopen karne ke liye reason likhna zaroori hai"); return; }
    setActing(true);
    try {
      const { error } = await supabase.from("cps_site_tasks").update({
        status: "in_progress",
        submitted_at: null,
        review_note: note.trim(),
        reviewed_by: user?.id ?? null,
        reopened_count: (detail.reopened_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq("id", detail.id);
      if (error) throw error;

      await supabase.from("cps_site_task_updates").insert({
        task_id: detail.id, update_type: "status_change",
        note: `Reopened: ${note.trim()}`, created_by: user?.id ?? null,
      });
      await audit(detail, "TASK_REOPENED", `Task "${detail.title}" reopened: ${note.trim()}`);
      await notifyUser({
        userId: detail.assigned_to,
        type: "task_reopened",
        title: `Kaam wapas khula: ${detail.title}`,
        body: note.trim(),
        link: `/my-work?task=${detail.id}`,
        entityType: "task",
        entityId: detail.id,
      });
      const whatsapp = await resolveWhatsapp(detail.assigned_to);
      await fireTaskWebhook("webhook_task_assigned", {
        event: "task_reopened",
        task_id: detail.id, task_number: detail.task_number, title: detail.title,
        project_code: detail.project_code, due_date: detail.due_date, priority: detail.priority,
        audience: detail.audience, description: note.trim(),
        assignee: { user_id: detail.assigned_to, name: userNames[detail.assigned_to] ?? null, whatsapp },
        assigned_by_name: user?.name ?? null,
      });
      toast.success("Task wapas khol diya");
      closeDetail();
      fetchAll();
    } catch (e) {
      toast.error("Reopen fail: " + (e as Error).message);
    } finally { setActing(false); }
  };

  const followUp = async () => {
    if (!detail) return;
    if (!note.trim()) { toast.error("Follow-up message likho"); return; }
    setActing(true);
    try {
      const { error } = await supabase.from("cps_site_task_updates").insert({
        task_id: detail.id, update_type: "comment", note: note.trim(), created_by: user?.id ?? null,
      });
      if (error) throw error;

      await notifyUser({
        userId: detail.assigned_to,
        type: "task_followup",
        title: `Follow-up: ${detail.title}`,
        body: note.trim(),
        link: `/my-work?task=${detail.id}`,
        entityType: "task",
        entityId: detail.id,
      });
      const whatsapp = await resolveWhatsapp(detail.assigned_to);
      await fireTaskWebhook("webhook_task_update", {
        event: "task_followup",
        task_id: detail.id, task_number: detail.task_number, title: detail.title,
        project_code: detail.project_code, due_date: detail.due_date,
        note: note.trim(), from_name: user?.name ?? null,
        recipient: { user_id: detail.assigned_to, name: userNames[detail.assigned_to] ?? null, whatsapp },
      });
      toast.success("Follow-up bhej diya");
      setNote("");
      openDetail(detail);
    } catch (e) {
      toast.error("Follow-up fail: " + (e as Error).message);
    } finally { setActing(false); }
  };

  const cancelTask = async () => {
    if (!detail) return;
    if (!note.trim()) { toast.error("Cancel karne ka reason likho"); return; }
    setActing(true);
    try {
      const { error } = await supabase.from("cps_site_tasks").update({
        status: "cancelled", review_note: note.trim(), reviewed_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", detail.id);
      if (error) throw error;
      await audit(detail, "TASK_CANCELLED", `Task "${detail.title}" cancelled: ${note.trim()}`);
      await notifyUser({
        userId: detail.assigned_to, type: "task_cancelled",
        title: `Kaam cancel ho gaya: ${detail.title}`, body: note.trim(),
        link: `/my-work`, entityType: "task", entityId: detail.id,
      });
      toast.success("Task cancel ho gaya");
      closeDetail();
      fetchAll();
    } catch (e) {
      toast.error("Cancel fail: " + (e as Error).message);
    } finally { setActing(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" /> Task Board
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Site engineers aur procurement ko diye gaye kaam — status, updates aur follow-up.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" onClick={() => setAssignOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Task Assign
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Open Tasks", value: stats.open, cls: "" },
          { label: "Overdue", value: stats.overdue, cls: "text-red-600" },
          { label: "Due This Week", value: stats.dueWeek, cls: "text-amber-600" },
          { label: "Needs Review", value: stats.review, cls: "text-blue-600" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Task, project ya person dhoondo…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Saare projects</SelectItem>
            {projects.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex gap-1">
          {(["all", "site", "procurement"] as const).map(a => (
            <Button
              key={a} size="sm"
              variant={audienceFilter === a ? "default" : "outline"}
              onClick={() => setAudienceFilter(a)}
            >
              {a === "all" ? "All" : a === "site" ? "Site" : "Procurement"}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-3 min-w-max">
            {COLUMNS.map(col => (
              <div key={col.key} className={`w-[280px] shrink-0 rounded-lg border border-border border-t-4 ${col.accent} bg-muted/20`}>
                <div className="px-3 py-2 border-b border-border/60">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{col.label}</span>
                    <Badge variant="secondary" className="text-[10px]">{grouped[col.key].length}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{col.desc}</p>
                </div>
                <div className="p-2 space-y-2 max-h-[65vh] overflow-y-auto">
                  {grouped[col.key].length === 0 && (
                    <p className="text-[11px] text-muted-foreground text-center py-6">Kuch nahi</p>
                  )}
                  {grouped[col.key].map(t => {
                    const badge = dueBadge(t);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => openDetail(t)}
                        className="w-full text-left bg-background border border-border rounded-md p-2.5 hover:border-primary/50 hover:shadow-sm transition-all space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-medium leading-snug line-clamp-2">{t.title}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${PRIORITY_META[t.priority].className}`}>
                            {PRIORITY_META[t.priority].label}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">{t.project_code}</p>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-muted-foreground truncate">
                            {userNames[t.assigned_to] ?? "—"}
                          </span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${badge.className}`}>
                            {badge.text}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                          <span className="font-mono">{t.task_number}</span>
                          <span className="ml-auto">{t.audience === "site" ? "Site" : "Procurement"}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail + actions */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) closeDetail(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {detail.title}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${PRIORITY_META[detail.priority].className}`}>
                    {PRIORITY_META[detail.priority].label}
                  </span>
                </DialogTitle>
                <DialogDescription className="font-mono text-xs">{detail.task_number}</DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><p className="text-muted-foreground">Project</p><p className="font-medium">{detail.project_code}</p></div>
                <div><p className="text-muted-foreground">Assigned to</p><p className="font-medium">{userNames[detail.assigned_to] ?? "—"}</p></div>
                <div><p className="text-muted-foreground">Completion date</p><p className="font-medium">{detail.due_date}</p></div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <p className="font-medium">
                    {isOverdue(detail) ? <span className="text-red-600">Overdue</span> : detail.status}
                    {detail.reopened_count > 0 && <span className="text-muted-foreground"> · {detail.reopened_count}× reopened</span>}
                  </p>
                </div>
              </div>

              {detail.description && (
                <p className="text-xs bg-muted/40 rounded p-2.5 whitespace-pre-wrap">{detail.description}</p>
              )}

              <div>
                <p className="text-xs font-semibold mb-1.5">Updates</p>
                {updatesLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : updates.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground py-3 text-center border border-dashed border-border rounded">
                    Abhi tak koi update nahi aaya
                  </p>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {updates.map(u => (
                      <div key={u.id} className="border border-border rounded-md p-2 text-xs space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[9px]">{u.update_type}</Badge>
                          {u.percent_complete != null && (
                            <span className="text-[10px] text-muted-foreground">{u.percent_complete}%</span>
                          )}
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {new Date(u.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        {u.note && <p className="whitespace-pre-wrap">{u.note}</p>}
                        {u.file_paths?.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {u.file_paths.map((p, i) => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => openSignedFile(p, { bucket: TASK_BUCKET, onError: (m) => toast.error(m) })}
                                className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                              >
                                <Paperclip className="h-3 w-3" /> File {i + 1}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Note (follow-up / approve / reopen / cancel ke liye)</Label>
                <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Message ya reason…" />
              </div>

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" size="sm" onClick={followUp} disabled={acting} className="w-full sm:w-auto">
                  <MessageSquare className="h-4 w-4 mr-1.5" /> Follow-up bhejo
                </Button>
                {detail.status !== "completed" && detail.status !== "cancelled" && (
                  <Button variant="outline" size="sm" onClick={cancelTask} disabled={acting} className="w-full sm:w-auto text-red-600 hover:text-red-700">
                    <XCircle className="h-4 w-4 mr-1.5" /> Cancel
                  </Button>
                )}
                {detail.status === "submitted" && (
                  <Button variant="outline" size="sm" onClick={reopen} disabled={acting} className="w-full sm:w-auto">
                    <RotateCcw className="h-4 w-4 mr-1.5" /> Reopen
                  </Button>
                )}
                {detail.status !== "completed" && (
                  <Button size="sm" onClick={approve} disabled={acting} className="w-full sm:w-auto">
                    <CheckCircle2 className="h-4 w-4 mr-1.5" /> Approve & Close
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {assignOpen && (
        <AssignTaskDialog
          open
          onOpenChange={setAssignOpen}
          onAssigned={fetchAll}
        />
      )}
    </div>
  );
}
