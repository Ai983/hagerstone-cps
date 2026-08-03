// Assign a task to a site engineer or to the procurement team.
//
// Used from two places — the Gantt on /schedule (pre-filled from a schedule activity)
// and the "Assign Task" button on /tasks. Both render it conditionally / with a key,
// so its useState defaults are the single source of truth: it never copies props into
// state via an effect (no-adjust-state-on-prop-change).

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PROCUREMENT_ASSIGNEE_ROLES, SITE_ASSIGNEE_ROLES, fireTaskWebhook, notifyUser,
  resolveWhatsapp, todayIso, type TaskAudience, type TaskPriority,
} from "@/lib/tasks";

interface AssigneeOption { id: string; name: string | null; email: string; role: string }

export interface AssignTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected project (the Gantt always passes one). */
  defaultProject?: string;
  defaultActivityId?: string | null;
  defaultTitle?: string;
  /** The activity's end date — the natural completion date for work off the schedule. */
  defaultDueDate?: string;
  onAssigned?: () => void;
}

export function AssignTaskDialog({
  open, onOpenChange, defaultProject = "", defaultActivityId = null,
  defaultTitle = "", defaultDueDate = "", onAssigned,
}: AssignTaskDialogProps) {
  const { user } = useAuth();

  const [projects, setProjects] = useState<string[]>([]);
  const [people, setPeople] = useState<AssigneeOption[]>([]);
  const [projectAssignee, setProjectAssignee] = useState<Record<string, string>>({});

  const [project, setProject] = useState(defaultProject);
  const [audience, setAudience] = useState<TaskAudience>("site");
  const [assignee, setAssignee] = useState("");
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [saving, setSaving] = useState(false);

  // One-shot load of the pickers. cps_projects is the single source of truth for
  // projects; cps_project_assignments tells us the engineer already on each site.
  useEffect(() => {
    (async () => {
      const [projRes, userRes, assignRes] = await Promise.all([
        supabase.from("cps_projects").select("name").eq("active", true),
        supabase.from("cps_users").select("id,name,email,role")
          .in("role", [...SITE_ASSIGNEE_ROLES, ...PROCUREMENT_ASSIGNEE_ROLES])
          .eq("active", true).order("name"),
        supabase.from("cps_project_assignments").select("project_code,assigned_to_user_id"),
      ]);
      setProjects(
        Array.from(new Set((projRes.data ?? []).map((r: { name: string | null }) => (r.name ?? "").trim()).filter(Boolean))).sort(),
      );
      setPeople((userRes.data ?? []) as AssigneeOption[]);
      const map: Record<string, string> = {};
      (assignRes.data ?? []).forEach((r: { project_code: string; assigned_to_user_id: string }) => {
        if (r.project_code && r.assigned_to_user_id) map[r.project_code] = r.assigned_to_user_id;
      });
      setProjectAssignee(map);
    })();
  }, []);

  const candidates = useMemo(
    () => people.filter(p => (audience === "site" ? SITE_ASSIGNEE_ROLES : PROCUREMENT_ASSIGNEE_ROLES).includes(p.role)),
    [people, audience],
  );

  // The engineer already assigned to this site is the obvious default — offered as a
  // hint the coordinator can override, not forced.
  const suggestedId = audience === "site" ? projectAssignee[project] : undefined;
  const effectiveAssignee = assignee || (suggestedId && candidates.some(c => c.id === suggestedId) ? suggestedId : "");

  const submit = async () => {
    if (!project) { toast.error("Project select karo"); return; }
    if (!title.trim()) { toast.error("Task ka title likho"); return; }
    if (!effectiveAssignee) { toast.error("Kisko dena hai, select karo"); return; }
    if (!dueDate) { toast.error("Completion date daalo"); return; }
    if (dueDate < todayIso()) { toast.error("Completion date aaj ya uske baad honi chahiye"); return; }

    setSaving(true);
    try {
      const { data: numData, error: numErr } = await supabase.rpc("cps_next_task_number");
      if (numErr) throw numErr;

      const { data: task, error } = await supabase
        .from("cps_site_tasks")
        .insert({
          task_number: numData as string,
          project_code: project,
          activity_id: defaultActivityId,
          title: title.trim(),
          description: description.trim() || null,
          assigned_to: effectiveAssignee,
          assigned_by: user?.id ?? null,
          audience,
          priority,
          due_date: dueDate,
        })
        .select()
        .single();
      if (error) throw error;

      const person = candidates.find(c => c.id === effectiveAssignee);

      await notifyUser({
        userId: effectiveAssignee,
        type: "task_assigned",
        title: `Naya kaam mila: ${title.trim()}`,
        body: `${project} · ${dueDate} tak poora karna hai`,
        link: `/my-work?task=${task.id}`,
        entityType: "task",
        entityId: task.id,
      });

      await supabase.from("cps_audit_log").insert({
        action_type: "TASK_ASSIGNED",
        entity_type: "task",
        entity_id: task.id,
        entity_number: task.task_number,
        description: `Task "${title.trim()}" assigned to ${person?.name ?? person?.email ?? "user"} for ${project}, due ${dueDate}`,
        user_id: user?.id ?? null,
        user_name: user?.name ?? null,
        user_role: user?.role ?? null,
      });

      const whatsapp = await resolveWhatsapp(effectiveAssignee);
      await fireTaskWebhook("webhook_task_assigned", {
        event: "task_assigned",
        task_id: task.id,
        task_number: task.task_number,
        title: title.trim(),
        description: description.trim() || null,
        project_code: project,
        activity_id: defaultActivityId,
        due_date: dueDate,
        priority,
        audience,
        assignee: { user_id: effectiveAssignee, name: person?.name ?? person?.email ?? null, whatsapp },
        assigned_by_name: user?.name ?? null,
      });

      if (!whatsapp) {
        toast.warning(`Task ban gaya, lekin ${person?.name ?? "is user"} ka WhatsApp number nahi mila — sirf in-app notification gaya`);
      } else {
        toast.success(`${task.task_number} assign ho gaya`);
      }
      onAssigned?.();
      onOpenChange(false);
    } catch (e) {
      toast.error("Task assign nahi hua: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Task Assign Karo</DialogTitle>
          <DialogDescription>
            {defaultActivityId
              ? "Schedule ki is activity ke liye kaam assign karo."
              : "Site engineer ya procurement team ko kaam do."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={project} onValueChange={setProject} disabled={!!defaultProject}>
              <SelectTrigger><SelectValue placeholder="Project select karo…" /></SelectTrigger>
              <SelectContent>
                {projects.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Kisko dena hai</Label>
            <div className="flex gap-2">
              {(["site", "procurement"] as TaskAudience[]).map(a => (
                <Button
                  key={a}
                  type="button"
                  size="sm"
                  variant={audience === a ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => { setAudience(a); setAssignee(""); }}
                >
                  {a === "site" ? "Site Engineer" : "Procurement"}
                </Button>
              ))}
            </div>
            <Select value={effectiveAssignee} onValueChange={setAssignee}>
              <SelectTrigger><SelectValue placeholder="Person select karo…" /></SelectTrigger>
              <SelectContent>
                {candidates.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    <div className="flex flex-col">
                      <span>{c.name ?? c.email}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {c.email} · {c.role}{suggestedId === c.id ? " · is site pe already assigned" : ""}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Task</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Kya karna hai" />
          </div>

          <div className="space-y-1.5">
            <Label>Details (optional)</Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Kaam ki detail, material, kis floor pe…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={v => setPriority(v as TaskPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Completion Date</Label>
              <Input type="date" min={todayIso()} value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Assign ho raha…" : "Assign & WhatsApp bhejo"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
