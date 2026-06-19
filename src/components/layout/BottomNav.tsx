import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, FileText, Send, ShoppingCart, Truck, MessageSquare,
  BarChart3, Users, Package, Shield, MoreHorizontal, LogOut, Building2, UserCircle, Boxes, ListChecks, Trophy, KanbanSquare, LineChart, ShieldCheck, Briefcase,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const ADMIN_PRIMARY = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "PRs", url: "/requisitions", icon: FileText },
  { title: "RFQs", url: "/rfqs", icon: Send },
  { title: "POs", url: "/purchase-orders", icon: ShoppingCart },
];

const ADMIN_MORE = [
  { title: "Quotes", url: "/quotes", icon: MessageSquare, roles: ["procurement_executive", "procurement_head", "it_head", "management", "auditor", "design_team"] },
  { title: "Comparison", url: "/comparison", icon: BarChart3, roles: ["procurement_executive", "procurement_head", "it_head", "management", "design_team"] },
  { title: "Work Orders", url: "/work-orders", icon: Briefcase, roles: ["procurement_executive", "procurement_head", "it_head", "management", "finance", "auditor", "accounts_team", "design_team"] },
  { title: "Kanban", url: "/kanban", icon: KanbanSquare, roles: ["procurement_executive", "procurement_head", "it_head", "management", "auditor", "finance", "accounts_team", "design_team"] },
  { title: "Analytics", url: "/analytics", icon: LineChart, roles: ["procurement_executive", "procurement_head", "it_head", "management", "finance", "auditor", "accounts_team", "design_team"] },
  { title: "Delivery", url: "/delivery", icon: Truck, roles: ["procurement_executive", "procurement_head", "it_head", "management", "finance", "auditor", "design_team"] },
  { title: "BOQ", url: "/boq", icon: ListChecks, roles: ["procurement_executive", "procurement_head", "it_head", "management", "accounts_team", "design_team"] },
  { title: "Stock", url: "/stock-overview", icon: Boxes, roles: ["procurement_executive", "procurement_head", "it_head", "management", "finance", "auditor", "accounts_team", "design_team"] },
  { title: "Site Stock", url: "/stock", icon: Boxes, roles: ["procurement_executive", "procurement_head", "it_head", "management", "design_team", "accounts_team"] },
  { title: "Suppliers", url: "/suppliers", icon: Users, roles: ["procurement_executive", "procurement_head", "it_head", "management", "auditor", "design_team"] },
  { title: "Items", url: "/items", icon: Package, roles: ["procurement_executive", "procurement_head", "it_head", "design_team"] },
  { title: "Audit Log", url: "/audit", icon: Shield, roles: ["auditor", "procurement_head", "it_head", "management", "design_team"] },
  { title: "Overrides", url: "/admin/overrides", icon: ShieldCheck, roles: ["it_head"] },
];

const EMPLOYEE_NAV = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Meri Requests", url: "/requisitions", icon: FileText },
  { title: "Quotes", url: "/site-quotes", icon: Trophy },
  { title: "Stock", url: "/stock", icon: Boxes },
];

const ROLE_LABELS: Record<string, string> = {
  requestor: "Requestor", procurement_executive: "Proc. Executive",
  procurement_head: "Proc. Head", it_head: "IT Head", management: "Management",
  finance: "Finance", site_receiver: "Site Receiver", auditor: "Auditor",
  accounts_team: "Accounts Team", design_team: "Design Team",
};

export function BottomNav() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  if (!user) return null;

  const isEmployee = user.role === 'requestor' || user.role === 'site_receiver';

  if (isEmployee) {
    return (
      <>
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 h-16 bg-sidebar text-sidebar-foreground border-t border-sidebar-border flex items-center">
          {EMPLOYEE_NAV.map(item => (
            <NavLink
              key={item.url}
              to={item.url}
              className={({ isActive }) => cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] min-h-[44px] transition-colors",
                isActive ? "text-sidebar-primary" : "text-sidebar-foreground/60"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.title}</span>
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] min-h-[44px] text-sidebar-foreground/60"
          >
            <UserCircle className="h-5 w-5" />
            <span>Account</span>
          </button>
        </nav>

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom" className="bg-sidebar text-sidebar-foreground border-sidebar-border pb-8">
            <SheetHeader className="mb-4">
              <SheetTitle className="flex items-center gap-2 text-sidebar-foreground">
                <Building2 className="h-5 w-5 text-sidebar-primary" />
                Hagerstone CPS
              </SheetTitle>
            </SheetHeader>
            <div className="border-t border-sidebar-border pt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-full bg-sidebar-primary/20 flex items-center justify-center">
                  <span className="text-sm font-bold text-sidebar-primary">{user.name?.charAt(0)}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-sidebar-foreground">{user.name}</p>
                  <p className="text-xs text-sidebar-foreground/60">{ROLE_LABELS[user.role] ?? user.role}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => { await signOut(); navigate("/login"); setMoreOpen(false); }}
                className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-md border border-sidebar-border text-sidebar-foreground/70 hover:bg-sidebar-accent transition-colors"
              >
                <LogOut className="h-4 w-4" /> Sign Out
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  const visibleMore = ADMIN_MORE.filter(item => item.roles.includes(user.role));

  return (
    <>
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 h-16 bg-sidebar text-sidebar-foreground border-t border-sidebar-border flex items-center">
        {ADMIN_PRIMARY.map(item => (
          <NavLink
            key={item.url}
            to={item.url}
            className={({ isActive }) => cn(
              "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] min-h-[44px] transition-colors",
              isActive ? "text-sidebar-primary" : "text-sidebar-foreground/60"
            )}
          >
            <item.icon className="h-5 w-5" />
            <span>{item.title}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] min-h-[44px] text-sidebar-foreground/60"
        >
          <MoreHorizontal className="h-5 w-5" />
          <span>More</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="bg-sidebar text-sidebar-foreground border-sidebar-border pb-8">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2 text-sidebar-foreground">
              <Building2 className="h-5 w-5 text-sidebar-primary" />
              Hagerstone CPS
            </SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-2 mb-4 max-h-[60vh] overflow-y-auto">
            {visibleMore.map(item => (
              <NavLink
                key={item.url}
                to={item.url}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) => cn(
                  "flex flex-col items-center gap-1.5 p-3 rounded-lg text-xs transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
                )}
              >
                <item.icon className="h-5 w-5" />
                <span>{item.title}</span>
              </NavLink>
            ))}
          </div>
          <div className="border-t border-sidebar-border pt-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-sidebar-primary/20 flex items-center justify-center">
                <span className="text-xs font-bold text-sidebar-primary">{user.name?.charAt(0)}</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-sidebar-foreground">{user.name}</p>
                <p className="text-xs text-sidebar-foreground/60">{ROLE_LABELS[user.role] ?? user.role}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => { await signOut(); navigate("/login"); setMoreOpen(false); }}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md border border-sidebar-border text-sidebar-foreground/70 hover:bg-sidebar-accent transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign Out
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
