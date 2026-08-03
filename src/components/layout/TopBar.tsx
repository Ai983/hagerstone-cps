import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Bell, Check, CheckCheck, FileText, ShoppingCart, MessageSquare, Send, Shield, ClipboardList } from "lucide-react";

const ROLE_COLORS: Record<string, string> = {
  procurement_head: "bg-primary/10 text-primary",
  it_head: "bg-primary/10 text-primary",
  management: "bg-purple-100 text-purple-800",
  auditor: "bg-red-100 text-red-800",
  procurement_executive: "bg-blue-100 text-blue-800",
  requestor: "bg-gray-100 text-gray-700",
  finance: "bg-green-100 text-green-800",
  site_receiver: "bg-orange-100 text-orange-800",
  accounts_team: "bg-teal-100 text-teal-800",
  design_team: "bg-violet-100 text-violet-800",
  project_coordinator: "bg-amber-100 text-amber-800",
};

const ROLE_LABELS: Record<string, string> = {
  requestor: "Requestor", procurement_executive: "Procurement Executive",
  procurement_head: "Procurement Head", it_head: "IT Head", management: "Management",
  finance: "Finance", site_receiver: "Site Receiver", auditor: "Auditor",
  accounts_team: "Accounts Team", design_team: "Design Team",
  project_coordinator: "Project Coordinator",
};

/* ── Notification types ── */

/**
 * Two sources feed the bell:
 *   - `personal` — cps_notifications rows addressed to THIS user (task assigned,
 *     reminder, follow-up). Read state lives in the DB, so it follows them across
 *     devices. Employees see only these.
 *   - `activity`  — the legacy global cps_audit_log feed, non-employees only, whose
 *     read state is still just a localStorage watermark.
 */
type NotifItem = {
  kind: "personal" | "activity";
  id: string;
  action_type: string;
  entity_type: string;
  entity_number: string | null;
  description: string;
  user_name: string | null;
  logged_at: string;
  severity: string;
  /** personal only */
  link?: string | null;
  title?: string;
  read_at?: string | null;
};

/* Map action_type to icon, color, label, and route */
const ACTION_CONFIG: Record<string, { icon: typeof FileText; color: string; label: string; route: string }> = {
  PR_CREATED:          { icon: FileText,      color: "text-blue-600 bg-blue-100",    label: "New PR",           route: "/requisitions" },
  RFQ_DISPATCHED:      { icon: Send,          color: "text-green-600 bg-green-100",  label: "RFQ Sent",         route: "/rfqs" },
  QUOTE_REVIEWED:      { icon: MessageSquare, color: "text-amber-600 bg-amber-100",  label: "Quote Reviewed",   route: "/quotes" },
  QUOTE_SUBMITTED_VIA_PORTAL: { icon: MessageSquare, color: "text-teal-600 bg-teal-100", label: "Quote Received", route: "/quotes" },
  PO_CREATED:          { icon: ShoppingCart,  color: "text-purple-600 bg-purple-100", label: "PO Created",      route: "/purchase-orders" },
  PO_APPROVED:         { icon: Check,         color: "text-green-700 bg-green-100",  label: "PO Approved",      route: "/purchase-orders" },
  PO_REJECTED:         { icon: Shield,        color: "text-red-600 bg-red-100",      label: "PO Rejected",      route: "/purchase-orders" },
  PO_PAYMENT_TERMS_SET:{ icon: ShoppingCart,  color: "text-indigo-600 bg-indigo-100", label: "Payment Terms Set", route: "/purchase-orders" },
  task_assigned:       { icon: ClipboardList, color: "text-amber-700 bg-amber-100",   label: "Naya Kaam",        route: "/my-work" },
  task_reminder:       { icon: ClipboardList, color: "text-red-600 bg-red-100",       label: "Reminder",         route: "/my-work" },
  task_followup:       { icon: MessageSquare, color: "text-blue-600 bg-blue-100",     label: "Follow-up",        route: "/my-work" },
  task_reopened:       { icon: ClipboardList, color: "text-amber-700 bg-amber-100",   label: "Wapas Khula",      route: "/my-work" },
  task_cancelled:      { icon: Shield,        color: "text-red-600 bg-red-100",       label: "Cancel",           route: "/my-work" },
  task_approved:       { icon: Check,         color: "text-green-700 bg-green-100",   label: "Approved",         route: "/my-work" },
  task_started:        { icon: ClipboardList, color: "text-blue-600 bg-blue-100",     label: "Kaam Shuru",       route: "/tasks" },
  task_progress:       { icon: ClipboardList, color: "text-blue-600 bg-blue-100",     label: "Task Update",      route: "/tasks" },
  task_submitted:      { icon: Check,         color: "text-teal-600 bg-teal-100",     label: "Review Chahiye",   route: "/tasks" },
};

const DEFAULT_CONFIG = { icon: FileText, color: "text-muted-foreground bg-muted", label: "Activity", route: "/audit" };

const STORAGE_KEY = "cps_notif_last_read";

export function TopBar() {
  const { user, isEmployee } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<NotifItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [lastReadAt, setLastReadAt] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  });
  const panelRef = useRef<HTMLDivElement>(null);

  // Everyone gets a bell now — site engineers need it for task assignments and
  // deadline reminders, which are addressed to them personally.
  const showBell = !!user;

  const fetchNotifs = useCallback(async () => {
    if (!user) return;
    const since = new Date();
    since.setDate(since.getDate() - 7);

    // Personal notifications: RLS already scopes cps_notifications to the caller.
    const personalReq = supabase
      .from("cps_notifications")
      .select("id,type,title,body,link,entity_type,entity_id,read_at,created_at")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(20);

    // Global activity feed — procurement context, not meaningful to field employees.
    const activityReq = isEmployee ? null : supabase
      .from("cps_audit_log")
      .select("id,action_type,entity_type,entity_number,description,user_name,logged_at,severity")
      .gte("logged_at", since.toISOString())
      .in("action_type", [
        "PR_CREATED", "RFQ_DISPATCHED", "QUOTE_REVIEWED",
        "QUOTE_SUBMITTED_VIA_PORTAL", "PO_CREATED", "PO_APPROVED",
        "PO_REJECTED", "PO_PAYMENT_TERMS_SET",
      ])
      .order("logged_at", { ascending: false })
      .limit(20);

    const [personalRes, activityRes] = await Promise.all([personalReq, activityReq]);

    const personal: NotifItem[] = (personalRes.data ?? []).map((n: {
      id: string; type: string; title: string; body: string | null; link: string | null;
      entity_type: string | null; read_at: string | null; created_at: string;
    }) => ({
      kind: "personal",
      id: n.id,
      action_type: n.type,
      entity_type: n.entity_type ?? "",
      entity_number: null,
      description: n.body ?? "",
      title: n.title,
      user_name: null,
      logged_at: n.created_at,
      severity: "info",
      link: n.link,
      read_at: n.read_at,
    }));

    const activity: NotifItem[] = ((activityRes?.data ?? []) as Array<Omit<NotifItem, "kind">>)
      .map((a) => ({ ...a, kind: "activity" as const }));

    const items = [...personal, ...activity].sort((a, b) => (a.logged_at < b.logged_at ? 1 : -1));
    setNotifs(items);

    const stored = localStorage.getItem(STORAGE_KEY) ?? "";
    setUnread(
      personal.filter((n) => !n.read_at).length +
      activity.filter((n) => !stored || n.logged_at > stored).length,
    );
  }, [user, isEmployee]);

  useEffect(() => {
    // Initial load + realtime subscribe. fetchNotifs is async — its setState calls
    // land in a later tick, not during this effect, so there is no cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchNotifs();
    if (!showBell) return;

    // The client is pinned to db.schema = "cps", but that does NOT apply to realtime —
    // the channel must name the schema explicitly or it silently never fires.
    const channel = supabase.channel("topbar-notifs");
    channel
      .on("postgres_changes", { event: "INSERT", schema: "cps", table: "cps_notifications" }, () => {
        fetchNotifs();
      })
      .on("postgres_changes", { event: "INSERT", schema: "cps", table: "cps_audit_log" }, () => {
        fetchNotifs();
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [user?.id, showBell, fetchNotifs]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markAllRead = async () => {
    const now = new Date().toISOString();
    // Personal read state lives in the DB so it survives a device change; the
    // global activity feed still uses the localStorage watermark.
    localStorage.setItem(STORAGE_KEY, now);
    setLastReadAt(now);
    setUnread(0);
    setNotifs((prev) => prev.map((n) => (n.kind === "personal" ? { ...n, read_at: now } : n)));
    if (user) {
      await supabase.from("cps_notifications").update({ read_at: now }).is("read_at", null);
    }
  };

  const handleOpenToggle = () => {
    setOpen((o) => !o);
  };

  const handleNotifClick = async (n: NotifItem) => {
    setOpen(false);
    if (n.kind === "personal") {
      if (!n.read_at) {
        const now = new Date().toISOString();
        setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: now } : x)));
        setUnread((u) => Math.max(0, u - 1));
        await supabase.from("cps_notifications").update({ read_at: now }).eq("id", n.id);
      }
      navigate(n.link || (ACTION_CONFIG[n.action_type] ?? DEFAULT_CONFIG).route);
      return;
    }
    navigate((ACTION_CONFIG[n.action_type] ?? DEFAULT_CONFIG).route);
  };

  const fmt = (ts: string) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  };

  const isUnread = (n: NotifItem) =>
    n.kind === "personal" ? !n.read_at : (!lastReadAt || n.logged_at > lastReadAt);

  return (
    <header className="h-14 flex items-center justify-between border-b border-border bg-background px-3 sm:px-6 shrink-0 gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground truncate">
          <span className="hidden sm:inline">Hagerstone International — Centralised Procurement</span>
          <span className="sm:hidden">Hagerstone CPS</span>
        </p>
        <p className="text-xs text-muted-foreground hidden sm:block">{new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      </div>
      {user && (
        <div className="flex items-center gap-3">
          <span className={`hidden sm:inline-flex text-xs px-2.5 py-1 rounded-full font-medium ${ROLE_COLORS[user.role] ?? ""}`}>
            {ROLE_LABELS[user.role] ?? user.role}
          </span>

          {/* Notification Bell */}
          {showBell && (
            <div className="relative" ref={panelRef}>
              <button
                type="button"
                onClick={handleOpenToggle}
                className="relative h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
              >
                <Bell className="h-4 w-4 text-muted-foreground" />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>

              {open && (
                <div className="fixed sm:absolute right-2 sm:right-0 top-14 sm:top-10 left-2 sm:left-auto sm:w-96 bg-background border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                  {/* Header */}
                  <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">Notifications</span>
                    <div className="flex items-center gap-2">
                      {unread > 0 && (
                        <button
                          type="button"
                          onClick={markAllRead}
                          className="text-[11px] text-primary hover:underline flex items-center gap-1"
                        >
                          <CheckCheck className="h-3 w-3" /> Mark all read
                        </button>
                      )}
                      <span className="text-[10px] text-muted-foreground">Last 7 days</span>
                    </div>
                  </div>

                  {/* List */}
                  {notifs.length === 0 ? (
                    <div className="px-4 py-10 text-center">
                      <Bell className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No recent activity</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/50 max-h-[400px] overflow-y-auto">
                      {notifs.map((n) => {
                        const config = ACTION_CONFIG[n.action_type] ?? DEFAULT_CONFIG;
                        const Icon = config.icon;
                        const unreadItem = isUnread(n);
                        return (
                          <div
                            key={n.id}
                            className={`px-4 py-3 cursor-pointer transition-colors flex gap-3 ${unreadItem ? "bg-primary/[0.03] hover:bg-primary/[0.06]" : "hover:bg-muted/40"}`}
                            onClick={() => handleNotifClick(n)}
                          >
                            {/* Icon */}
                            <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${config.color}`}>
                              <Icon className="h-3.5 w-3.5" />
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-xs font-semibold text-foreground truncate">
                                    {n.kind === "personal" ? (n.title ?? config.label) : config.label}
                                  </span>
                                  {n.entity_number && (
                                    <span className="font-mono text-[11px] text-primary font-medium truncate">{n.entity_number}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {unreadItem && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{fmt(n.logged_at)}</span>
                                </div>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{n.description}</p>
                              {n.user_name && (
                                <p className="text-[10px] text-muted-foreground/70 mt-0.5">by {n.user_name}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Footer */}
                  <div className="px-4 py-2 border-t border-border">
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline w-full text-center"
                      onClick={() => { setOpen(false); navigate(isEmployee ? "/my-work" : "/audit"); }}
                    >
                      {isEmployee ? "Mera Kaam dekho" : "View full activity log"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-sm font-bold text-primary">{user.name?.charAt(0)}</span>
            </div>
            <span className="text-sm font-medium hidden sm:block">{user.name}</span>
          </div>
        </div>
      )}
    </header>
  );
}
