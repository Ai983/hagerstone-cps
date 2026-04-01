import React from "react";
import { useAuth } from "@/contexts/AuthContext";

const ROLE_COLORS: Record<string, string> = {
  procurement_head: "bg-primary/10 text-primary",
  management: "bg-purple-100 text-purple-800",
  auditor: "bg-red-100 text-red-800",
  procurement_executive: "bg-blue-100 text-blue-800",
  requestor: "bg-gray-100 text-gray-700",
  finance: "bg-green-100 text-green-800",
  site_receiver: "bg-orange-100 text-orange-800",
};

const ROLE_LABELS: Record<string, string> = {
  requestor: "Requestor", procurement_executive: "Procurement Executive",
  procurement_head: "Procurement Head", management: "Management",
  finance: "Finance", site_receiver: "Site Receiver", auditor: "Auditor",
};

export function TopBar() {
  const { user } = useAuth();
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
