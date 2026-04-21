import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Bell, Check, CheckCheck, FileText, ShoppingCart, MessageSquare, Send, Shield } from "lucide-react";

const ROLE_COLORS: Record<string, string> = {
  procurement_head: "bg-primary/10 text-primary",
  it_head: "bg-primary/10 text-primary",
  management: "bg-purple-100 text-purple-800",
  auditor: "bg-red-100 text-red-800",
  procurement_executive: "bg-blue-100 text-blue-800",
  requestor: "bg-gray-100 text-gray-700",
  finance: "bg-green-100 text-green-800",
  site_receiver: "bg-orange-100 text-orange-800",
};

const ROLE_LABELS: Record<string, string> = {
  requestor: "Requestor", procurement_executive: "Procurement Executive",
  procurement_head: "Procurement Head", it_head: "IT Head", management: "Management",
  finance: "Finance", site_receiver: "Site Receiver", auditor: "Auditor",
};

/* ── Notification types ── */

type NotifItem = {
  id: string;
  action_type: string;
  entity_type: string;
  entity_number: string | null;
  description: string;
  user_name: string | null;
  logged_at: string;
  severity: string;
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

  const showBell = user && !isEmployee;

  const fetchNotifs = useCallback(async () => {
    if (!user || isEmployee) return;
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const { data } = await supabase
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

    const items = (data ?? []) as NotifItem[];
    setNotifs(items);

    // Count unread based on lastReadAt
    const stored = localStorage.getItem(STORAGE_KEY) ?? "";
    const unreadCount = stored
      ? items.filter((n) => n.logged_at > stored).length
      : items.length;
    setUnread(unreadCount);
  }, [user, isEmployee]);

  useEffect(() => {
    fetchNotifs();

    if (!showBell) return undefined;

    // Listen for new audit log entries
    const channel = supabase
      .channel("topbar-notifs")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cps_audit_log" }, () => {
        fetchNotifs();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, showBell, fetchNotifs]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markAllRead = () => {
    const now = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, now);
    setLastReadAt(now);
    setUnread(0);
  };

  const handleOpenToggle = () => {
    setOpen((o) => !o);
  };

  const handleNotifClick = (n: NotifItem) => {
    setOpen(false);
    const config = ACTION_CONFIG[n.action_type] ?? DEFAULT_CONFIG;
    navigate(config.route);
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

  const isUnread = (n: NotifItem) => !lastReadAt || n.logged_at > lastReadAt;

  return (
    <header className="h-14 flex items-center justify-between border-b border-border bg-background px-6 shrink-0">
      <div>
        <p className="text-sm font-semibold text-foreground">Hagerstone International — Centralised Procurement</p>
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
                <div className="absolute right-0 top-10 w-96 bg-background border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                  {/* Header */}
                  <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">Notifications</span>
                    <div className="flex items-center gap-2">
                      {unread > 0 && (
                        <button
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
                                  <span className="text-xs font-semibold text-foreground">{config.label}</span>
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
                      className="text-xs text-primary hover:underline w-full text-center"
                      onClick={() => { setOpen(false); navigate("/audit"); }}
                    >
                      View full activity log
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
