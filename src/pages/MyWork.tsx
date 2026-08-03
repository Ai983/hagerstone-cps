// Mera Kaam — the assignee's view of the tasks a project coordinator gave them.
//
// Serves site engineers (reached from EMPLOYEE_NAV) and procurement assignees
// (reached from the sidebar as "My Tasks") off the same cps_site_tasks rows.
// Mobile-first: a card list on phones mirrored by a table on desktop, the shape
// SiteQuotes.tsx established for field users.
//
// Progress can be reported at ANY time while the work is ongoing, and again at
// completion — every update can carry PDFs, Excel sheets or photos as evidence.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  CheckCircle2, HardHat, Paperclip, Play, RefreshCw, Upload, X,
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { openSignedFile } from "@/lib/storageUrl";
import {
  PRIORITY_META, STATUS_LABELS, TASK_BUCKET, dueBadge, fireTaskWebhook, isOverdue,
  notifyUser, resolveWhatsapp, uploadTaskFiles, type SiteTask, type TaskUpdate,
} from "@/lib/tasks";

type UpdateMode = "progress" | "completion";

export default function MyWork() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tasks, setTasks] = useState<SiteTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<SiteTask | null>(null);
  const [updates, setUpdates] = useState<TaskUpdate[]>([]);

  // Update dialog
  const [mode, setMode] = useState<UpdateMode | null>(null);
  const [target, setTarget] = useState<SiteTask | null>(null);
  const [note, setNote] = useState("");
  const [percent, setPercent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from("cps_site_tasks").select("*")
        .eq("assigned_to", user.id)
        .neq("status", "cancelled")
        .order("due_date", { ascending: true });
      setTasks((data ?? []) as SiteTask[]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const deepLinkId = searchParams.get("task");
  useEffect(() => {
    if (!deepLinkId || !tasks.length) return;
    const t = tasks.find(x => x.id === deepLinkId);
    if (t) openDetail(t);
  }, [deepLinkId, tasks]);

  const open = useMemo(() => tasks.filter(t => t.status !== "completed"), [tasks]);
  const stats = useMemo(() => ({
    open: open.length,
    overdue: open.filter(isOverdue).length,
    running: tasks.filter(t => t.status === "in_progress").length,
    done: tasks.filter(t => t.status === "completed").length,
  }), [tasks, open]);

  const openDetail = async (t: SiteTask) => {
    setDetail(t);
    const { data } = await supabase
      .from("cps_site_task_updates").select("*").eq("task_id", t.id)
      .order("created_at", { ascending: false });
    setUpdates((data ?? []) as TaskUpdate[]);
  };

  const closeDetail = () => {
    setDetail(null);
    setUpdates([]);
    if (deepLinkId) { searchParams.delete("task"); setSearchParams(searchParams, { replace: true }); }
  };

  const startTask = async (t: SiteTask) => {
    const { error } = await supabase.from("cps_site_tasks").update({
      status: "in_progress",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", t.id);
    if (error) { toast.error("Start nahi hua: " + error.message); return; }

    await supabase.from("cps_site_task_updates").insert({
      task_id: t.id, update_type: "status_change", note: "Kaam shuru kiya", created_by: user?.id ?? null,
    });
    if (t.assigned_by) {
      await notifyUser({
        userId: t.assigned_by, type: "task_started",
        title: `${user?.name ?? "Engineer"} ne kaam shuru kiya`,
        body: t.title, link: `/tasks?task=${t.id}`, entityType: "task", entityId: t.id,
      });
    }
    toast.success("Kaam shuru — ab beech beech me update daalte rehna");
    fetchTasks();
  };

  const openUpdate = (t: SiteTask, m: UpdateMode) => {
    setTarget(t);
    setMode(m);
    setNote("");
    setPercent("");
    setFiles([]);
  };

  const submitUpdate = async () => {
    if (!target || !mode) return;
    if (!note.trim() && files.length === 0) { toast.error("Kuch likho ya file lagao"); return; }
    if (mode === "completion" && files.length === 0) {
      toast.error("Kaam poora karne ke liye kam se kam ek file (photo/PDF/Excel) lagani hogi");
      return;
    }

    setSaving(true);
    try {
      const paths = files.length ? await uploadTaskFiles(target.id, files) : [];

      const { error } = await supabase.from("cps_site_task_updates").insert({
        task_id: target.id,
        update_type: mode,
        note: note.trim() || null,
        file_paths: paths,
        percent_complete: percent ? Number(percent) : null,
        created_by: user?.id ?? null,
      });
      if (error) throw error;

      if (mode === "completion") {
        const { error: upErr } = await supabase.from("cps_site_tasks").update({
          status: "submitted",
          submitted_at: new Date().toISOString(),
          completion_note: note.trim() || null,
          updated_at: new Date().toISOString(),
        }).eq("id", target.id);
        if (upErr) throw upErr;
      } else if (target.status === "assigned") {
        // Posting progress implicitly starts the task.
        await supabase.from("cps_site_tasks").update({
          status: "in_progress", started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("id", target.id);
      }

      if (target.assigned_by) {
        await notifyUser({
          userId: target.assigned_by,
          type: mode === "completion" ? "task_submitted" : "task_progress",
          title: mode === "completion"
            ? `Kaam poora bataya: ${target.title}`
            : `Update aaya: ${target.title}`,
          body: note.trim() || `${paths.length} file(s)`,
          link: `/tasks?task=${target.id}`,
          entityType: "task",
          entityId: target.id,
        });
        const whatsapp = await resolveWhatsapp(target.assigned_by);
        await fireTaskWebhook("webhook_task_update", {
          event: mode === "completion" ? "task_submitted" : "task_progress",
          task_id: target.id,
          task_number: target.task_number,
          title: target.title,
          project_code: target.project_code,
          due_date: target.due_date,
          note: note.trim() || null,
          percent_complete: percent ? Number(percent) : null,
          file_count: paths.length,
          from_name: user?.name ?? null,
          recipient: { user_id: target.assigned_by, whatsapp },
        });
      }

      await supabase.from("cps_audit_log").insert({
        action_type: mode === "completion" ? "TASK_SUBMITTED" : "TASK_PROGRESS",
        entity_type: "task",
        entity_id: target.id,
        entity_number: target.task_number,
        description: mode === "completion"
          ? `Task "${target.title}" submitted for review with ${paths.length} file(s)`
          : `Progress update on "${target.title}"${paths.length ? ` with ${paths.length} file(s)` : ""}`,
        user_id: user?.id ?? null,
        user_name: user?.name ?? null,
        user_role: user?.role ?? null,
      });

      toast.success(mode === "completion" ? "Kaam bhej diya — coordinator check karega" : "Update daal diya");
      setMode(null);
      setTarget(null);
      fetchTasks();
      if (detail?.id === target.id) openDetail(target);
    } catch (e) {
      toast.error("Update fail: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <HardHat className="h-6 w-6 text-primary" /> Mera Kaam
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Coordinator ne jo kaam diya hai. Beech me update daalo, aur poora hone pe photo/PDF ke saath bhejo.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchTasks} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Baaki Kaam", value: stats.open, cls: "" },
          { label: "Late", value: stats.overdue, cls: "text-red-600" },
          { label: "Chal Raha", value: stats.running, cls: "text-blue-600" },
          { label: "Ho Gaya", value: stats.done, cls: "text-green-600" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <HardHat className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Abhi koi kaam assign nahi hua hai.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile */}
          <div className="sm:hidden space-y-2">
            {tasks.map(t => {
              const badge = dueBadge(t);
              return (
                <Card key={t.id}>
                  <CardContent className="p-3 space-y-2">
                    <button type="button" className="w-full text-left space-y-1" onClick={() => openDetail(t)}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium leading-snug">{t.title}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${PRIORITY_META[t.priority].className}`}>
                          {PRIORITY_META[t.priority].label}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{t.project_code}</p>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.className}`}>{badge.text}</span>
                        <span className="text-[10px] text-muted-foreground">{STATUS_LABELS[t.status]}</span>
                      </div>
                    </button>
                    {t.status !== "completed" && (
                      <div className="flex gap-1.5">
                        {t.status === "assigned" && (
                          <Button size="sm" variant="outline" className="flex-1 min-h-[38px]" onClick={() => startTask(t)}>
                            <Play className="h-3.5 w-3.5 mr-1" /> Shuru
                          </Button>
                        )}
                        {t.status !== "submitted" && (
                          <>
                            <Button size="sm" variant="outline" className="flex-1 min-h-[38px]" onClick={() => openUpdate(t, "progress")}>
                              <Upload className="h-3.5 w-3.5 mr-1" /> Update
                            </Button>
                            <Button size="sm" className="flex-1 min-h-[38px]" onClick={() => openUpdate(t, "completion")}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Poora
                            </Button>
                          </>
                        )}
                        {t.status === "submitted" && (
                          <p className="text-[11px] text-amber-700 py-1.5">Coordinator check kar raha hai…</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Desktop */}
          <Card className="hidden sm:block">
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map(t => {
                    const badge = dueBadge(t);
                    return (
                      <TableRow key={t.id} className="cursor-pointer" onClick={() => openDetail(t)}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{t.title}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${PRIORITY_META[t.priority].className}`}>
                              {PRIORITY_META[t.priority].label}
                            </span>
                          </div>
                          <span className="font-mono text-[10px] text-muted-foreground">{t.task_number}</span>
                        </TableCell>
                        <TableCell className="text-xs">{t.project_code}</TableCell>
                        <TableCell>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.className}`}>{badge.text}</span>
                          <span className="block text-[10px] text-muted-foreground mt-0.5">{t.due_date}</span>
                        </TableCell>
                        <TableCell className="text-xs">{STATUS_LABELS[t.status]}</TableCell>
                        <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                          {t.status === "assigned" && (
                            <Button size="sm" variant="outline" onClick={() => startTask(t)}>
                              <Play className="h-3.5 w-3.5 mr-1" /> Shuru Karo
                            </Button>
                          )}
                          {(t.status === "in_progress") && (
                            <div className="flex justify-end gap-1.5">
                              <Button size="sm" variant="outline" onClick={() => openUpdate(t, "progress")}>Update Daalo</Button>
                              <Button size="sm" onClick={() => openUpdate(t, "completion")}>Kaam Poora</Button>
                            </div>
                          )}
                          {t.status === "submitted" && <span className="text-[11px] text-amber-700">Review me hai</span>}
                          {t.status === "completed" && <span className="text-[11px] text-green-700">Approved</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* Detail / history */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) closeDetail(); }}>
        <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.title}</DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  {detail.task_number} · {detail.project_code} · {detail.due_date} tak
                </DialogDescription>
              </DialogHeader>
              {detail.description && (
                <p className="text-xs bg-muted/40 rounded p-2.5 whitespace-pre-wrap">{detail.description}</p>
              )}
              {detail.review_note && (
                <p className="text-xs bg-amber-50 border border-amber-200 rounded p-2.5">
                  <span className="font-semibold">Coordinator: </span>{detail.review_note}
                </p>
              )}
              <div className="space-y-2">
                <p className="text-xs font-semibold">History</p>
                {updates.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground py-3 text-center border border-dashed border-border rounded">
                    Abhi tak koi update nahi
                  </p>
                ) : updates.map(u => (
                  <div key={u.id} className="border border-border rounded-md p-2 text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[9px]">{u.update_type}</Badge>
                      {u.percent_complete != null && <span className="text-[10px] text-muted-foreground">{u.percent_complete}%</span>}
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {new Date(u.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {u.note && <p className="whitespace-pre-wrap">{u.note}</p>}
                    {u.file_paths?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {u.file_paths.map((p, i) => (
                          <button
                            key={p} type="button"
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
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Progress / completion update. Rendered conditionally so its state resets per task. */}
      {target && mode && (
        <Dialog open onOpenChange={(o) => { if (!o) { setMode(null); setTarget(null); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{mode === "completion" ? "Kaam Poora" : "Update Daalo"}</DialogTitle>
              <DialogDescription>
                {mode === "completion"
                  ? "Poora hone ka proof lagao — photo, PDF ya Excel. Coordinator check karke approve karega."
                  : "Kaam kahan tak pahuncha? Photo/PDF/Excel jo bhi ho, laga do."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{mode === "completion" ? "Kya kya hua" : "Kya update hai"}</Label>
                <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Chhoti si detail…" />
              </div>

              {mode === "progress" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Kitna % ho gaya (optional)</Label>
                  <Input type="number" min={0} max={100} value={percent} onChange={e => setPercent(e.target.value)} placeholder="0-100" />
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">
                  File {mode === "completion" ? "(zaroori)" : "(optional)"}
                </Label>
                <Input
                  type="file"
                  multiple
                  onChange={e => setFiles(Array.from(e.target.files ?? []))}
                />
                {files.length > 0 && (
                  <div className="space-y-1">
                    {files.map(f => (
                      <div key={f.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Paperclip className="h-3 w-3" /> <span className="truncate">{f.name}</span>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      onClick={() => setFiles([])}
                    >
                      <X className="h-3 w-3" /> Hata do
                    </button>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setMode(null); setTarget(null); }} disabled={saving}>Cancel</Button>
              <Button onClick={submitUpdate} disabled={saving}>
                {saving ? "Bhej raha…" : mode === "completion" ? "Poora Bhejo" : "Update Bhejo"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
