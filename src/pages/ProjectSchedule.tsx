// Project Schedule — the Project Coordinator's home screen.
//
// Upload the project's execution schedule, review/fix the activities, then work them:
// every activity can be edited, added or deleted at any time (not just before saving),
// and each one is where a task gets assigned to a site engineer or to procurement.
//
// Two views over the same activities:
//   Timeline — a Gantt, hand-rolled from divs (the repo has no chart library; the
//              shadcn ui/chart.tsx stub imports recharts, which is NOT installed).
//   List     — a table with per-activity Assign / Edit / Delete.
// Bar colour and row status both come from cps_schedule_activity_progress, which is
// derived from the tasks on that activity — never stored, never hand-set.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarRange, FilePlus2, FileSpreadsheet, LayoutList, Loader2, Pencil, Plus,
  RefreshCw, Sparkles, Trash2, Upload, UserPlus, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fileToClaudeBlock } from "@/lib/imageForClaude";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AssignTaskDialog } from "@/components/tasks/AssignTaskDialog";
import { openSignedFile } from "@/lib/storageUrl";
import { todayIso } from "@/lib/tasks";
import {
  durationDays, isP6Export, parseP6Activities, readWorkbook, workbookToText,
  type ParsedActivity,
} from "@/lib/scheduleParse";

const MAX_BYTES = 10 * 1024 * 1024;
const DAY_MS = 86_400_000;

type ActivityStatus = "not_started" | "in_progress" | "done" | "delayed";

interface ScheduleRow {
  id: string;
  project_code: string;
  file_name: string | null;
  file_path: string | null;
  source_type: string;
  parse_status: string;
  activity_count: number;
  schedule_start: string | null;
  schedule_end: string | null;
  version: number;
  created_at: string;
}

interface ActivityRow {
  id: string;
  seq: number;
  activity_name: string;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  phase: string | null;
  responsibility: string | null;
}

interface ProgressRow {
  activity_id: string;
  task_count: number;
  completed_count: number;
  open_count: number;
  overdue_count: number;
  activity_status: ActivityStatus;
}

/** A row in the pre-save review table. AI/P6 output is a pre-fill, never a direct insert. */
interface DraftActivity extends ParsedActivity {
  _key: string;
  start_date: string;
  end_date: string;
  phase: string;
  responsibility: string;
}

const STATUS_META: Record<ActivityStatus, { label: string; bar: string; chip: string }> = {
  not_started: { label: "Not started", bar: "bg-muted-foreground/30", chip: "bg-muted text-muted-foreground border-border" },
  in_progress: { label: "In progress", bar: "bg-blue-500",            chip: "bg-blue-100 text-blue-800 border-blue-200" },
  done:        { label: "Done",        bar: "bg-green-600",           chip: "bg-green-100 text-green-800 border-green-200" },
  delayed:     { label: "Delayed",     bar: "bg-red-500",             chip: "bg-red-100 text-red-800 border-red-200" },
};

const dayIndex = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(new Date(y, (m ?? 1) - 1, d ?? 1).getTime() / DAY_MS);
};

const addDaysIso = (iso: string, days: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, (d ?? 1) + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

const fmtShort = (iso: string | null): string => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

const EXTRACT_PROMPT = `You are reading a construction / interior fit-out PROJECT EXECUTION SCHEDULE.

Extract every real work activity with its planned dates. Return ONLY valid JSON in exactly this shape, no markdown:

{
  "activities": [
    { "activity_name": "string", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "phase": "string or null", "responsibility": "string or null" }
  ]
}

Rules:
- Dates MUST be YYYY-MM-DD. Day-first (DD-MM-YYYY) is the house format — 04-08-2026 is 4 August 2026, NOT 8 April.
- If a date is genuinely absent, use null — never guess one.
- If only a start date and a duration are given, compute the end date.
- Keep the schedule's own row order.
- "phase" is the parent/WBS grouping if the source has one, else null.
- "responsibility" is the owning team/trade if the source names one, else null.
- SKIP header rows, blank rows, legends, totals, notes and signature blocks.
- Do NOT invent activities. If the document has none, return {"activities": []}.`;

const blankDraft = (): DraftActivity => ({
  _key: crypto.randomUUID(), activity_name: "", start_date: "", end_date: "",
  phase: "", responsibility: "", raw_row: null,
});

const toDraft = (a: ParsedActivity): DraftActivity => ({
  _key: crypto.randomUUID(),
  activity_name: a.activity_name,
  start_date: a.start_date ?? "",
  end_date: a.end_date ?? "",
  phase: a.phase ?? "",
  responsibility: a.responsibility ?? "",
  raw_row: a.raw_row ?? null,
});

export default function ProjectSchedule() {
  const { user } = useAuth();

  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"timeline" | "list">("timeline");

  const [schedule, setSchedule] = useState<ScheduleRow | null>(null);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressRow>>({});

  // Upload + review
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<DraftActivity[]>([]);
  const [parseSource, setParseSource] = useState<"p6" | "ai" | null>(null);

  // Live activity CRUD (after save)
  const [editing, setEditing] = useState<ActivityRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<ActivityRow | null>(null);
  const [assignFor, setAssignFor] = useState<ActivityRow | null>(null);
  const [creatingBlank, setCreatingBlank] = useState(false);

  useEffect(() => {
    (async () => {
      // Single source of truth: the cps_projects master.
      const { data } = await supabase.from("cps_projects").select("name").eq("active", true);
      const unique = Array.from(
        new Set((data ?? []).map((r: { name: string | null }) => (r.name ?? "").trim()).filter(Boolean)),
      ).sort();
      setProjects(unique);
      if (unique.length) setProject((p) => p || unique[0]);
    })();
  }, []);

  const loadSchedule = useCallback(async (projectCode: string) => {
    if (!projectCode) return;
    setLoading(true);
    try {
      const { data: sched } = await supabase
        .from("cps_project_schedules").select("*")
        .eq("project_code", projectCode).eq("is_current", true)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      if (!sched) { setSchedule(null); setActivities([]); setProgress({}); return; }
      setSchedule(sched as ScheduleRow);

      const [actRes, progRes] = await Promise.all([
        supabase.from("cps_schedule_activities")
          .select("id,seq,activity_name,start_date,end_date,duration_days,phase,responsibility")
          .eq("schedule_id", (sched as ScheduleRow).id).order("seq"),
        supabase.from("cps_schedule_activity_progress").select("*")
          .eq("schedule_id", (sched as ScheduleRow).id),
      ]);
      setActivities((actRes.data ?? []) as ActivityRow[]);
      const map: Record<string, ProgressRow> = {};
      (progRes.data ?? []).forEach((r) => { map[(r as ProgressRow).activity_id] = r as ProgressRow; });
      setProgress(map);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSchedule(project); }, [project, loadSchedule]);

  /* ── Upload → parse (P6 deterministic, AI fallback) ────────────────────── */

  const pickFile = (f: File | null) => {
    if (!f) { setFile(null); return; }
    if (f.size > MAX_BYTES) { toast.error("File 10 MB se choti honi chahiye"); return; }
    setFile(f);
    setDraft([]);
    setParseSource(null);
  };

  const runAiExtract = async (contentBlock: unknown): Promise<ParsedActivity[]> => {
    const { data, error } = await supabase.functions.invoke("claude-proxy", {
      body: {
        model: "gpt-5.6-luna",
        max_tokens: 50000,
        messages: [{ role: "user", content: [contentBlock, { type: "text", text: EXTRACT_PROMPT }] }],
      },
    });
    if (error) throw new Error(error.message);
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    const textBlock = ((data as { content?: Array<{ type: string; text: string }> })?.content ?? [])
      .find((b) => b.type === "text");
    const match = (textBlock?.text ?? "").match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response me JSON nahi mila");
    const parsed = JSON.parse(match[0]) as { activities?: Array<Record<string, string | null>> };
    return (parsed.activities ?? []).map((r) => ({
      activity_name: String(r.activity_name ?? "").trim(),
      start_date: r.start_date || null,
      end_date: r.end_date || null,
      phase: r.phase || null,
      responsibility: r.responsibility || null,
      raw_row: r,
    }));
  };

  const parseFile = async () => {
    if (!file) return;
    setParsing(true);
    try {
      const isExcel = /\.(xlsx|xls|csv)$/i.test(file.name);
      let rows: ParsedActivity[] = [];
      let source: "p6" | "ai" = "ai";

      if (isExcel) {
        const wb = await readWorkbook(file);
        // A Primavera P6 export has machine-fixed column keys, so read it directly:
        // exact dates, no model cost, and none of P6's stock resource library in the prompt.
        if (isP6Export(wb)) {
          rows = parseP6Activities(wb);
          source = "p6";
        }
        if (!rows.length) {
          const sheetText = workbookToText(wb);
          if (!sheetText.trim()) throw new Error("Excel khaali hai");
          rows = await runAiExtract({
            type: "text",
            text: `Below is the contents of a project schedule workbook (each sheet shown as CSV):\n\n${sheetText}`,
          });
          source = "ai";
        }
      } else if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        rows = await runAiExtract(await fileToClaudeBlock(file));
        source = "ai";
      } else {
        throw new Error("Sirf Excel (xlsx/xls/csv) ya PDF chalega");
      }

      const clean = rows.filter((r) => r.activity_name);
      if (!clean.length) throw new Error("Is file me koi activity nahi mili — dobara check karo");

      setDraft(clean.map(toDraft));
      setParseSource(source);
      toast.success(
        source === "p6"
          ? `${clean.length} activities Primavera export se seedhe padhi gayi`
          : `${clean.length} activities mili — check karke save karo`,
      );
    } catch (e) {
      toast.error("Parse fail: " + (e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const patchDraft = (key: string, patch: Partial<DraftActivity>) =>
    setDraft((d) => d.map((r) => (r._key === key ? { ...r, ...patch } : r)));

  const saveSchedule = async () => {
    if (!project || !file) return;
    const clean = draft.filter((r) => r.activity_name.trim());
    if (!clean.length) { toast.error("Ek bhi activity nahi bachi"); return; }

    setSaving(true);
    try {
      const ext = file.name.split(".").pop() ?? "xlsx";
      const safeProject = project.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `schedules/${safeProject}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("cps-quotes").upload(path, file);
      if (upErr) throw upErr;

      // Previous uploads stay on record — they just stop driving the view.
      await supabase.from("cps_project_schedules")
        .update({ is_current: false, updated_at: new Date().toISOString() })
        .eq("project_code", project).eq("is_current", true);

      const dates = clean.flatMap((r) => [r.start_date, r.end_date]).filter(Boolean).sort();
      const { data: sched, error } = await supabase
        .from("cps_project_schedules")
        .insert({
          project_code: project, file_name: file.name, file_path: path,
          source_type: /\.(xlsx|xls|csv)$/i.test(file.name) ? "excel" : "pdf",
          parse_status: "parsed", activity_count: clean.length,
          schedule_start: dates[0] ?? null, schedule_end: dates[dates.length - 1] ?? null,
          version: (schedule?.version ?? 0) + 1, is_current: true, uploaded_by: user?.id ?? null,
        })
        .select().single();
      if (error) throw error;

      const { error: actErr } = await supabase.from("cps_schedule_activities").insert(
        clean.map((r, i) => ({
          schedule_id: sched.id, project_code: project, seq: i,
          activity_name: r.activity_name.trim(),
          start_date: r.start_date || null, end_date: r.end_date || null,
          duration_days: durationDays(r.start_date || null, r.end_date || null),
          phase: r.phase.trim() || null, responsibility: r.responsibility.trim() || null,
          raw_row: r.raw_row ?? null,
        })),
      );
      if (actErr) throw actErr;

      await supabase.from("cps_audit_log").insert({
        action_type: "SCHEDULE_UPLOADED", entity_type: "project_schedule",
        entity_id: sched.id, entity_number: project,
        description: `Schedule v${sched.version} uploaded for ${project} — ${clean.length} activities from ${file.name} (${parseSource === "p6" ? "Primavera export" : "AI extraction"})`,
        user_id: user?.id ?? null, user_name: user?.name ?? null, user_role: user?.role ?? null,
      });

      toast.success(`Schedule save ho gaya — ${clean.length} activities`);
      setUploadOpen(false); setFile(null); setDraft([]); setParseSource(null);
      loadSchedule(project);
    } catch (e) {
      toast.error("Save fail: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Start a schedule inside CPS with no file at all. For a ten-activity fit-out that
   * would otherwise mean a detour through Primavera just to produce something to
   * upload — the coordinator adds activities directly instead. Everything downstream
   * (Gantt, assignment, roll-up) is identical; only source_type differs.
   */
  const createBlankSchedule = async () => {
    if (!project) { toast.error("Pehle project select karo"); return; }
    setCreatingBlank(true);
    try {
      await supabase.from("cps_project_schedules")
        .update({ is_current: false, updated_at: new Date().toISOString() })
        .eq("project_code", project).eq("is_current", true);

      const { data: sched, error } = await supabase
        .from("cps_project_schedules")
        .insert({
          project_code: project, source_type: "manual", parse_status: "parsed",
          activity_count: 0, version: (schedule?.version ?? 0) + 1,
          is_current: true, uploaded_by: user?.id ?? null,
        })
        .select().single();
      if (error) throw error;

      await supabase.from("cps_audit_log").insert({
        action_type: "SCHEDULE_CREATED", entity_type: "project_schedule",
        entity_id: sched.id, entity_number: project,
        description: `Blank schedule v${sched.version} created in CPS for ${project}`,
        user_id: user?.id ?? null, user_name: user?.name ?? null, user_role: user?.role ?? null,
      });

      toast.success("Khaali schedule ban gaya — ab activities add karo");
      setView("list");
      await loadSchedule(project);
      setEditing("new");
    } catch (e) {
      toast.error("Schedule nahi bana: " + (e as Error).message);
    } finally {
      setCreatingBlank(false);
    }
  };

  /* ── Live activity CRUD (on the saved schedule) ────────────────────────── */

  /** Keep the schedule header's span + count honest after any activity change. */
  const resyncScheduleHeader = async (scheduleId: string) => {
    const { data } = await supabase.from("cps_schedule_activities")
      .select("start_date,end_date").eq("schedule_id", scheduleId);
    const dates = (data ?? []).flatMap((r: { start_date: string | null; end_date: string | null }) =>
      [r.start_date, r.end_date]).filter(Boolean).sort() as string[];
    await supabase.from("cps_project_schedules").update({
      activity_count: (data ?? []).length,
      schedule_start: dates[0] ?? null,
      schedule_end: dates[dates.length - 1] ?? null,
      updated_at: new Date().toISOString(),
    }).eq("id", scheduleId);
  };

  const saveActivity = async (form: {
    activity_name: string; start_date: string; end_date: string;
    phase: string; responsibility: string;
  }) => {
    if (!schedule) return;
    if (!form.activity_name.trim()) { toast.error("Activity ka naam likho"); return; }
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      toast.error("Finish date, start date se pehle nahi ho sakti"); return;
    }
    const payload = {
      activity_name: form.activity_name.trim(),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      duration_days: durationDays(form.start_date || null, form.end_date || null),
      phase: form.phase.trim() || null,
      responsibility: form.responsibility.trim() || null,
    };
    try {
      if (editing && editing !== "new") {
        const { error } = await supabase.from("cps_schedule_activities")
          .update(payload).eq("id", editing.id);
        if (error) throw error;
        await supabase.from("cps_audit_log").insert({
          action_type: "SCHEDULE_ACTIVITY_UPDATED", entity_type: "schedule_activity",
          entity_id: editing.id, entity_number: project,
          description: `Activity "${payload.activity_name}" edited (${payload.start_date ?? "—"} → ${payload.end_date ?? "—"})`,
          user_id: user?.id ?? null, user_name: user?.name ?? null, user_role: user?.role ?? null,
        });
        toast.success("Activity update ho gayi");
      } else {
        const { error } = await supabase.from("cps_schedule_activities").insert({
          ...payload, schedule_id: schedule.id, project_code: project,
          seq: (activities[activities.length - 1]?.seq ?? -1) + 1,
        });
        if (error) throw error;
        await supabase.from("cps_audit_log").insert({
          action_type: "SCHEDULE_ACTIVITY_ADDED", entity_type: "schedule_activity",
          entity_id: schedule.id, entity_number: project,
          description: `Activity "${payload.activity_name}" added to ${project} schedule`,
          user_id: user?.id ?? null, user_name: user?.name ?? null, user_role: user?.role ?? null,
        });
        toast.success("Nayi activity add ho gayi");
      }
      await resyncScheduleHeader(schedule.id);
      setEditing(null);
      loadSchedule(project);
    } catch (e) {
      toast.error("Save fail: " + (e as Error).message);
    }
  };

  const deleteActivity = async () => {
    if (!deleting || !schedule) return;
    try {
      const { error } = await supabase.from("cps_schedule_activities").delete().eq("id", deleting.id);
      if (error) throw error;
      await supabase.from("cps_audit_log").insert({
        action_type: "SCHEDULE_ACTIVITY_DELETED", entity_type: "schedule_activity",
        entity_id: deleting.id, entity_number: project,
        description: `Activity "${deleting.activity_name}" deleted from ${project} schedule`,
        user_id: user?.id ?? null, user_name: user?.name ?? null, user_role: user?.role ?? null,
      });
      await resyncScheduleHeader(schedule.id);
      toast.success("Activity hata di");
      setDeleting(null);
      loadSchedule(project);
    } catch (e) {
      toast.error("Delete fail: " + (e as Error).message);
    }
  };

  /* ── Gantt geometry ────────────────────────────────────────────────────── */

  const span = useMemo(() => {
    const all = activities.flatMap((a) => [a.start_date, a.end_date]).filter(Boolean).sort() as string[];
    const first = all[0] ?? todayIso();
    const last = all[all.length - 1] ?? addDaysIso(first, 30);
    const from = addDaysIso(first, -3);
    const to = addDaysIso(last, 3);
    return { from, to, days: Math.max(1, dayIndex(to) - dayIndex(from)) };
  }, [activities]);

  const barGeometry = (a: ActivityRow) => {
    if (!a.start_date && !a.end_date) return null;
    const s = a.start_date ?? a.end_date!;
    const e = a.end_date ?? a.start_date!;
    const left = ((dayIndex(s) - dayIndex(span.from)) / span.days) * 100;
    const width = Math.max(1.2, ((dayIndex(e) - dayIndex(s) + 1) / span.days) * 100);
    return { left: `${Math.max(0, left)}%`, width: `${Math.min(100 - Math.max(0, left), width)}%` };
  };

  const todayPct = useMemo(() => {
    const pct = ((dayIndex(todayIso()) - dayIndex(span.from)) / span.days) * 100;
    return pct >= 0 && pct <= 100 ? pct : null;
  }, [span]);

  const monthTicks = useMemo(() => {
    const ticks: Array<{ label: string; pct: number }> = [];
    const [fy, fm] = span.from.split("-").map(Number);
    const cur = new Date(fy, (fm ?? 1) - 1, 1);
    const end = dayIndex(span.to);
    for (let i = 0; i < 60; i++) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-01`;
      const idx = dayIndex(iso);
      if (idx > end) break;
      if (idx >= dayIndex(span.from)) {
        ticks.push({
          label: cur.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
          pct: ((idx - dayIndex(span.from)) / span.days) * 100,
        });
      }
      cur.setMonth(cur.getMonth() + 1);
    }
    return ticks;
  }, [span]);

  const statusOf = (a: ActivityRow): ActivityStatus => progress[a.id]?.activity_status ?? "not_started";

  const stats = useMemo(() => {
    const rows = activities.map(statusOf);
    return {
      total: activities.length,
      delayed: rows.filter((s) => s === "delayed").length,
      inProgress: rows.filter((s) => s === "in_progress").length,
      done: rows.filter((s) => s === "done").length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities, progress]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarRange className="h-6 w-6 text-primary" /> Project Schedule
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Schedule yahin CPS me bana lo, ya Primavera/Excel/PDF se upload karo — phir har activity pe task assign karo.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => loadSchedule(project)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={createBlankSchedule} disabled={creatingBlank || !project}>
            <FilePlus2 className="h-4 w-4 mr-1.5" /> {creatingBlank ? "Ban raha…" : "CPS me Banao"}
          </Button>
          <Button size="sm" onClick={() => { setUploadOpen(true); setFile(null); setDraft([]); setParseSource(null); }}>
            <Upload className="h-4 w-4 mr-1.5" /> Schedule Upload
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <Select value={project} onValueChange={setProject}>
          <SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="Project select karo…" /></SelectTrigger>
          <SelectContent>{projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>

        {schedule && (
          <>
            <div className="flex gap-1">
              <Button size="sm" variant={view === "timeline" ? "default" : "outline"} onClick={() => setView("timeline")}>
                <CalendarRange className="h-4 w-4 mr-1.5" /> Timeline
              </Button>
              <Button size="sm" variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")}>
                <LayoutList className="h-4 w-4 mr-1.5" /> Activities
              </Button>
            </div>
            {schedule.file_path ? (
              <Button variant="ghost" size="sm"
                onClick={() => openSignedFile(schedule.file_path, { onError: (m) => toast.error(m) })}>
                <FileSpreadsheet className="h-4 w-4 mr-1.5" />
                {schedule.file_name ?? "Schedule file"} · v{schedule.version}
              </Button>
            ) : (
              <Badge variant="secondary" className="text-[10px]">CPS me bana · v{schedule.version}</Badge>
            )}
          </>
        )}
      </div>

      {activities.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Activities", value: stats.total, cls: "" },
            { label: "In Progress", value: stats.inProgress, cls: "text-blue-600" },
            { label: "Delayed", value: stats.delayed, cls: "text-red-600" },
            { label: "Done", value: stats.done, cls: "text-green-600" },
          ].map((s) => (
            <Card key={s.label}><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
            </CardContent></Card>
          ))}
        </div>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : !schedule ? (
        <Card><CardContent className="py-14 text-center space-y-4">
          <CalendarRange className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">
            {project ? `${project} ka abhi koi schedule nahi hai.` : "Pehle project select karo."}
          </p>
          {project && (
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4 mr-1.5" /> Primavera / Excel / PDF Upload Karo
              </Button>
              <Button size="sm" variant="outline" onClick={createBlankSchedule} disabled={creatingBlank}>
                <FilePlus2 className="h-4 w-4 mr-1.5" /> Yahin CPS me Banao
              </Button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Bada project Primavera se upload karo; chhote site ke liye seedhe yahan activities add kar lo.
          </p>
        </CardContent></Card>
      ) : activities.length === 0 ? (
        <Card><CardContent className="py-14 text-center space-y-3">
          <LayoutList className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">
            Schedule ban gaya hai, lekin abhi koi activity nahi hai.
          </p>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4 mr-1.5" /> Pehli Activity Add Karo
          </Button>
        </CardContent></Card>
      ) : view === "timeline" ? (
        <Card><CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 border-b border-border text-[11px] text-muted-foreground">
            {(Object.keys(STATUS_META) as ActivityStatus[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${STATUS_META[s].bar}`} /> {STATUS_META[s].label}
              </span>
            ))}
            <span className="ml-auto">Bar pe click karke task assign karo</span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              <div className="flex items-end border-b border-border">
                <div className="w-64 shrink-0 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">Activity</div>
                <div className="flex-1 relative h-7">
                  {monthTicks.map((t) => (
                    <div key={t.label + t.pct} className="absolute top-0 bottom-0 border-l border-border/60" style={{ left: `${t.pct}%` }}>
                      <span className="pl-1 text-[10px] text-muted-foreground whitespace-nowrap">{t.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="divide-y divide-border/50">
                {activities.map((a) => {
                  const p = progress[a.id];
                  const status = statusOf(a);
                  const geo = barGeometry(a);
                  return (
                    <div key={a.id} className="flex items-center hover:bg-muted/30">
                      <div className="w-64 shrink-0 px-3 py-2 min-w-0">
                        <p className="text-xs font-medium truncate" title={a.activity_name}>{a.activity_name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {fmtShort(a.start_date)} → {fmtShort(a.end_date)}
                          {p && p.task_count > 0 && ` · ${p.completed_count}/${p.task_count} tasks`}
                        </p>
                      </div>
                      <div className="flex-1 relative h-11">
                        {monthTicks.map((t) => (
                          <div key={t.pct} className="absolute top-0 bottom-0 border-l border-border/30" style={{ left: `${t.pct}%` }} />
                        ))}
                        {todayPct !== null && (
                          <div className="absolute top-0 bottom-0 border-l-2 border-primary/50" style={{ left: `${todayPct}%` }} />
                        )}
                        {geo ? (
                          <button type="button" onClick={() => setAssignFor(a)}
                            title={`${a.activity_name} — ${STATUS_META[status].label}. Click to assign a task.`}
                            className={`absolute top-1/2 -translate-y-1/2 h-5 rounded ${STATUS_META[status].bar} hover:ring-2 hover:ring-primary/60 transition-shadow flex items-center px-1.5`}
                            style={geo}>
                            {p && p.overdue_count > 0 && (
                              <span className="text-[9px] font-bold text-white">{p.overdue_count} late</span>
                            )}
                          </button>
                        ) : (
                          <button type="button" onClick={() => setAssignFor(a)}
                            className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-primary underline">
                            date nahi hai — assign karo
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent></Card>
      ) : (
        /* ── Activity list: full CRUD + per-activity assign ── */
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <p className="text-sm font-medium">{activities.length} activities</p>
              <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
                <Plus className="h-4 w-4 mr-1.5" /> Activity Add Karo
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>Finish</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tasks</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activities.map((a, i) => {
                    const p = progress[a.id];
                    const st = statusOf(a);
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{a.activity_name}</p>
                          {(a.phase || a.responsibility) && (
                            <p className="text-[10px] text-muted-foreground">
                              {[a.phase, a.responsibility].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{fmtShort(a.start_date)}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{fmtShort(a.end_date)}</TableCell>
                        <TableCell className="text-xs">{a.duration_days ?? "—"}</TableCell>
                        <TableCell>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_META[st].chip}`}>
                            {STATUS_META[st].label}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {p && p.task_count > 0 ? (
                            <span>
                              {p.completed_count}/{p.task_count}
                              {p.overdue_count > 0 && <span className="text-red-600 font-medium"> · {p.overdue_count} late</span>}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button size="sm" className="h-7 mr-1" onClick={() => setAssignFor(a)}>
                            <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(a)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                            onClick={() => setDeleting(a)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload + review */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Schedule Upload — {project}</DialogTitle>
            <DialogDescription>
              Primavera P6 export, Excel ya PDF. Save karne se pehle activities check aur theek kar lo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Schedule file</Label>
              <Input type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
              <p className="text-[11px] text-muted-foreground">
                Max 10 MB · Primavera P6 export seedhe padha jaata hai; baaki files AI se.
              </p>
            </div>

            {file && draft.length === 0 && (
              <Button onClick={parseFile} disabled={parsing} className="w-full">
                {parsing ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Padha ja raha hai…</> : "Activities Nikaalo"}
              </Button>
            )}

            {draft.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{draft.length} activities</p>
                    {parseSource === "p6" ? (
                      <Badge variant="secondary" className="text-[10px]">Primavera export — exact</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> AI extracted — check karo
                      </Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setDraft((d) => [...d, blankDraft()])}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Row add karo
                  </Button>
                </div>
                <div className="border border-border rounded-md max-h-[45vh] overflow-y-auto divide-y divide-border/50">
                  {draft.map((r, i) => (
                    <div key={r._key} className="p-2 grid grid-cols-12 gap-2 items-center">
                      <span className="col-span-12 sm:col-span-1 text-[11px] text-muted-foreground">{i + 1}</span>
                      <Input className="col-span-12 sm:col-span-5 h-8 text-xs" value={r.activity_name}
                        placeholder="Activity" onChange={(e) => patchDraft(r._key, { activity_name: e.target.value })} />
                      <Input type="date" className="col-span-6 sm:col-span-2 h-8 text-xs" value={r.start_date}
                        onChange={(e) => patchDraft(r._key, { start_date: e.target.value })} />
                      <Input type="date" className="col-span-6 sm:col-span-2 h-8 text-xs" value={r.end_date}
                        onChange={(e) => patchDraft(r._key, { end_date: e.target.value })} />
                      <Input className="col-span-10 sm:col-span-1 h-8 text-xs" value={r.phase} placeholder="Phase"
                        onChange={(e) => patchDraft(r._key, { phase: e.target.value })} />
                      <button type="button"
                        className="col-span-2 sm:col-span-1 h-8 flex items-center justify-center text-muted-foreground hover:text-red-600"
                        onClick={() => setDraft((d) => d.filter((x) => x._key !== r._key))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                {schedule && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    Save karne pe ye v{(schedule.version ?? 0) + 1} ban jayega. Purana schedule record me rahega,
                    aur purani activities pe lage tasks wahi ke wahi rahenge.
                  </p>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={saving || parsing}>
              <X className="h-4 w-4 mr-1.5" /> Band karo
            </Button>
            <Button onClick={saveSchedule} disabled={saving || !draft.length}>
              {saving ? "Save ho raha…" : "Schedule Save Karo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / edit one activity on the live schedule */}
      {editing && (
        <ActivityFormDialog
          key={editing === "new" ? "new" : editing.id}
          activity={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={saveActivity}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activity delete karein?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleting?.activity_name}" schedule se hat jayegi.
              {(progress[deleting?.id ?? ""]?.task_count ?? 0) > 0 && (
                <span className="block mt-2 text-amber-700">
                  Is activity pe {progress[deleting!.id].task_count} task lage hain — wo delete NAHI honge,
                  bas is activity se unlink ho jayenge aur Task Board pe waise hi dikhte rahenge.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Rehne do</AlertDialogCancel>
            <AlertDialogAction onClick={deleteActivity}>Delete karo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rendered conditionally so its useState defaults reset per activity. */}
      {assignFor && (
        <AssignTaskDialog
          key={assignFor.id}
          open
          onOpenChange={(o) => { if (!o) setAssignFor(null); }}
          defaultProject={project}
          defaultActivityId={assignFor.id}
          defaultTitle={assignFor.activity_name}
          defaultDueDate={assignFor.end_date && assignFor.end_date >= todayIso() ? assignFor.end_date : ""}
          onAssigned={() => { setAssignFor(null); loadSchedule(project); }}
        />
      )}
    </div>
  );
}

/* ── Add/edit form. Mounted fresh per activity (key=id), so useState defaults are the
      single source of truth — no copying props into state via an effect. ── */
function ActivityFormDialog({
  activity, onCancel, onSave,
}: {
  activity: ActivityRow | null;
  onCancel: () => void;
  onSave: (f: { activity_name: string; start_date: string; end_date: string; phase: string; responsibility: string }) => Promise<void>;
}) {
  const [activityName, setActivityName] = useState(activity?.activity_name ?? "");
  const [startDate, setStartDate] = useState(activity?.start_date ?? "");
  const [endDate, setEndDate] = useState(activity?.end_date ?? "");
  const [phase, setPhase] = useState(activity?.phase ?? "");
  const [responsibility, setResponsibility] = useState(activity?.responsibility ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    await onSave({ activity_name: activityName, start_date: startDate, end_date: endDate, phase, responsibility });
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{activity ? "Activity Edit Karo" : "Nayi Activity"}</DialogTitle>
          <DialogDescription>
            {activity
              ? "Naam ya dates badlo — Gantt aur task deadlines usi hisaab se chalenge."
              : "Schedule me jo activity chhoot gayi hai, wo yahan add karo."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Activity</Label>
            <Input value={activityName} onChange={(e) => setActivityName(e.target.value)} placeholder="Kaam ka naam" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Start</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Finish</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Phase (optional)</Label>
              <Input value={phase} onChange={(e) => setPhase(e.target.value)} placeholder="e.g. INTERIOR WORK" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Responsibility (optional)</Label>
              <Input value={responsibility} onChange={(e) => setResponsibility(e.target.value)} placeholder="e.g. MEP" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Save ho raha…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
