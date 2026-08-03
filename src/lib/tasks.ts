// Shared types + helpers for the Project Coordinator task loop
// (/schedule → /tasks → /my-work). Everything that both the coordinator board and
// the assignee page need lives here so the two can't drift apart.

import { supabase } from "@/integrations/supabase/client";

export const TASK_BUCKET = "cps-task-updates";

export type TaskStatus = "assigned" | "in_progress" | "submitted" | "completed" | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskAudience = "site" | "procurement";

export interface SiteTask {
  id: string;
  task_number: string | null;
  project_code: string;
  activity_id: string | null;
  title: string;
  description: string | null;
  assigned_to: string;
  assigned_by: string | null;
  audience: TaskAudience;
  priority: TaskPriority;
  due_date: string;            // YYYY-MM-DD
  status: TaskStatus;
  started_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  completion_note: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  reopened_count: number;
  created_at: string;
}

export interface TaskUpdate {
  id: string;
  task_id: string;
  update_type: "progress" | "completion" | "comment" | "status_change";
  note: string | null;
  file_paths: string[];
  percent_complete: number | null;
  created_by: string | null;
  created_at: string;
}

export interface ScheduleActivity {
  id: string;
  schedule_id: string;
  project_code: string;
  seq: number;
  activity_name: string;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  phase: string | null;
  responsibility: string | null;
}

/** Roles that may be assigned a task, split by audience. */
export const SITE_ASSIGNEE_ROLES = ["requestor", "site_receiver"];
export const PROCUREMENT_ASSIGNEE_ROLES = ["procurement_executive", "procurement_head"];

export const PRIORITY_META: Record<TaskPriority, { label: string; className: string }> = {
  low:    { label: "Low",    className: "bg-muted text-muted-foreground border-border" },
  normal: { label: "Normal", className: "bg-blue-100 text-blue-800 border-blue-200" },
  high:   { label: "High",   className: "bg-amber-100 text-amber-800 border-amber-200" },
  urgent: { label: "Urgent", className: "bg-red-100 text-red-800 border-red-200" },
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  assigned: "Assigned",
  in_progress: "In Progress",
  submitted: "Submitted",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Today as YYYY-MM-DD in local time (the DB stores plain dates, not timestamps). */
export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Overdue is DERIVED, never stored — same principle as KanbanBoard.deriveStage().
 * A completed/cancelled task is never overdue however old its due date is.
 */
export const isOverdue = (t: Pick<SiteTask, "due_date" | "status">): boolean =>
  t.status !== "completed" && t.status !== "cancelled" && t.due_date < todayIso();

/** Whole days from today to the due date (negative = past due). */
export const daysToDue = (dueDate: string): number => {
  const [y, m, d] = dueDate.split("-").map(Number);
  const due = new Date(y, (m ?? 1) - 1, d ?? 1);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - now.getTime()) / 86_400_000);
};

/** Due-date badge wording + colour, shared by the board and Mera Kaam. */
export const dueBadge = (t: Pick<SiteTask, "due_date" | "status">): { text: string; className: string } => {
  if (t.status === "completed") return { text: "Ho gaya", className: "bg-green-100 text-green-800 border-green-200" };
  if (t.status === "cancelled") return { text: "Cancel", className: "bg-muted text-muted-foreground border-border" };
  const days = daysToDue(t.due_date);
  if (days < 0) return { text: `${Math.abs(days)}d late`, className: "bg-red-100 text-red-800 border-red-200" };
  if (days === 0) return { text: "Aaj tak", className: "bg-red-100 text-red-800 border-red-200" };
  if (days === 1) return { text: "Kal tak", className: "bg-amber-100 text-amber-800 border-amber-200" };
  return { text: `${days}d baaki`, className: "bg-muted text-muted-foreground border-border" };
};

/**
 * Fire an n8n webhook whose URL lives in cps_config. Always fire-and-forget: the
 * WhatsApp send must never block or fail the DB write that just succeeded.
 * No-ops on the REPLACE_WITH_N8N_WEBHOOK_URL placeholder the migration seeds.
 */
export async function fireTaskWebhook(configKey: string, payload: Record<string, unknown>): Promise<void> {
  const { data } = await supabase.from("cps_config").select("value").eq("key", configKey).maybeSingle();
  const url = (data as { value?: string } | null)?.value;
  // Some webhook_* rows hold a note rather than a URL (the reminder cron is
  // schedule-driven), and unconfigured ones hold the REPLACE_WITH placeholder.
  if (!url || !url.startsWith("http")) return;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => { /* non-blocking webhook */ });
}

/**
 * Write an in-app notification for one user.
 *
 * NEVER chain `.select()` here. cps_notifications' SELECT policy is
 * `user_id = current_cps_user_id()`, and Postgres evaluates the SELECT policy against
 * the RETURNING row — so asking for the inserted row back fails with a misleading
 * 42501 "new row violates row-level security policy" even though the INSERT itself is
 * allowed. A bare .insert() sends `Prefer: return=minimal` and works. (Verified against
 * the live DB 2026-08-01: representation → 403, minimal → 201.)
 */
export async function notifyUser(args: {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
}): Promise<void> {
  await supabase.from("cps_notifications").insert({
    user_id: args.userId,
    type: args.type,
    title: args.title,
    body: args.body ?? null,
    link: args.link ?? null,
    entity_type: args.entityType ?? null,
    entity_id: args.entityId ?? null,
  });
}

/**
 * The assignee's WhatsApp number, resolved by the DB so the app payload and the
 * n8n reminder cron can never disagree: cps_users.whatsapp → cps_users.phone →
 * finance.employees.phone (matched on email), normalised to 91XXXXXXXXXX.
 */
export async function resolveWhatsapp(userId: string): Promise<string | null> {
  const { data } = await supabase.rpc("cps_resolve_user_whatsapp", { p_user_id: userId });
  return (data as string | null) ?? null;
}

/** Upload task evidence (PDF / Excel / image / anything) and return the stored paths. */
export async function uploadTaskFiles(taskId: string, files: File[]): Promise<string[]> {
  const paths: string[] = [];
  for (const f of files) {
    const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${taskId}/${Date.now()}_${safeName}`;
    const { data, error } = await supabase.storage.from(TASK_BUCKET).upload(storagePath, f);
    if (error) throw new Error(`Upload fail (${f.name}): ${error.message}`);
    paths.push(data.path);
  }
  return paths;
}
