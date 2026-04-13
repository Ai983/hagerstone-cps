import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Bell } from "lucide-react";

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

type NotifPR = {
  id: string;
  pr_number: string;
  project_code: string | null;
  project_site: string;
  status: string;
  created_at: string;
  requester_name?: string;
};

export function TopBar() {
  const { user, isEmployee } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<NotifPR[]>([]);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const showBell = user && !isEmployee;

  const fetchNotifs = async () => {
    if (!user || isEmployee) return;
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const query = supabase
      .from("cps_purchase_requisitions")
      .select("id,pr_number,project_code,project_site,status,created_at,requested_by")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(10);

    const { data } = await query;
    const rows = (data ?? []) as any[];

    // Resolve requester names
    const ids = Array.from(new Set(rows.map((r) => r.requested_by).filter(Boolean)));
    const nameMap: Record<string, string> = {};
    if (ids.length) {
      const { data: users } = await supabase.from("cps_users").select("id,name").in("id", ids);
      (users ?? []).forEach((u: any) => { nameMap[u.id] = u.name; });
    }

    const items: NotifPR[] = rows.map((r) => ({ ...r, requester_name: nameMap[r.requested_by] ?? "—" }));
    setNotifs(items);
    setUnread(items.length);
  };

  useEffect(() => {
    fetchNotifs();

    // Real-time subscription
    if (!showBell) return;
    const channel = supabase
      .channel("topbar-pr-notifs")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cps_purchase_requisitions" }, () => {
        fetchNotifs();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fmt = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  const statusColor: Record<string, string> = {
    pending: "bg-blue-100 text-blue-700",
    validated: "bg-cyan-100 text-cyan-700",
    rfq_created: "bg-green-100 text-green-700",
    cancelled: "bg-red-100 text-red-700",
  };

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
                onClick={() => { setOpen(o => !o); if (!open) setUnread(0); }}
                className="relative h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
              >
                <Bell className="h-4 w-4 text-muted-foreground" />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>

              {open && (
                <div className="absolute right-0 top-10 w-80 bg-background border border-border rounded-lg shadow-lg z-50 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">Recent PRs</span>
                    <span className="text-xs text-muted-foreground">Last 7 days</span>
                  </div>
                  {notifs.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">No new PRs</div>
                  ) : (
                    <div className="divide-y divide-border max-h-80 overflow-y-auto">
                      {notifs.map((n) => (
                        <div
                          key={n.id}
                          className="px-4 py-3 hover:bg-muted/40 cursor-pointer transition-colors"
                          onClick={() => { setOpen(false); navigate("/requisitions"); }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-semibold text-primary">{n.pr_number}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusColor[n.status] ?? "bg-muted text-muted-foreground"}`}>
                              {n.status.replace(/_/g, " ")}
                            </span>
                          </div>
                          <p className="text-xs text-foreground mt-0.5 truncate">{n.project_code ?? n.project_site}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">by {n.requester_name} · {fmt(n.created_at)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="px-4 py-2 border-t border-border">
                    <button className="text-xs text-primary hover:underline w-full text-center" onClick={() => { setOpen(false); navigate("/requisitions"); }}>
                      View all PRs →
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
