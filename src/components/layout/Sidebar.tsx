import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, Package, FileText, Send, MessageSquare, BarChart3, ShoppingCart, Truck, Shield, ChevronLeft, ChevronRight, LogOut, Building2, Upload, ClipboardCheck, KanbanSquare, LineChart, Boxes, ListChecks } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const NAV = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, roles: ["all"] },
  { title: "Kanban Board", url: "/kanban", icon: KanbanSquare, roles: ["procurement_executive","procurement_head","it_head","management","auditor","finance"] },
  { title: "Analytics", url: "/analytics", icon: LineChart, roles: ["procurement_executive","procurement_head","it_head","management","finance","auditor"] },
  { title: "Purchase Requests", url: "/requisitions", icon: FileText, roles: ["all"] },
  { title: "RFQs", url: "/rfqs", icon: Send, roles: ["procurement_executive","procurement_head","it_head","management","auditor"] },
  { title: "Quotes", url: "/quotes", icon: MessageSquare, roles: ["procurement_executive","procurement_head","it_head","management","auditor"] },
  { title: "Comparison", url: "/comparison", icon: BarChart3, roles: ["procurement_executive","procurement_head","it_head","management"] },
  { title: "Purchase Orders", url: "/purchase-orders", icon: ShoppingCart, roles: ["procurement_executive","procurement_head","it_head","management","finance"] },
  { title: "Delivery Tracker", url: "/delivery", icon: Truck, roles: ["all"] },
  { title: "BOQ", url: "/boq", icon: ListChecks, roles: ["procurement_executive","procurement_head","it_head","management"] },
  { title: "Stock Overview", url: "/stock-overview", icon: Boxes, roles: ["procurement_executive","procurement_head","it_head","management","finance","auditor"] },
  { title: "Supplier Master", url: "/suppliers", icon: Users, roles: ["procurement_executive","procurement_head","it_head","management","auditor"] },
  { title: "Item Master", url: "/items", icon: Package, roles: ["procurement_executive","procurement_head","it_head"] },
  { title: "Invoice Upload", url: "/invoices/upload", icon: Upload, roles: ["procurement_executive","procurement_head","it_head","management"] },
  { title: "Audit Log", url: "/audit", icon: Shield, roles: ["auditor","procurement_head","it_head","management"] },
];


const EMPLOYEE_NAV = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Meri Requests", url: "/requisitions", icon: FileText },
  { title: "Delivery Status", url: "/delivery", icon: Truck },
  { title: "Stock", url: "/stock", icon: Boxes },
  { title: "Saman List", url: "/items", icon: Package },
];

export function AppSidebar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const isEmployee = user?.role === 'requestor' || user?.role === 'site_receiver';
  const visible = isEmployee
    ? EMPLOYEE_NAV
    : NAV.filter(n => n.roles.includes("all") || n.roles.includes(user?.role ?? ""));

  return (
    <div className={cn("hidden lg:flex flex-col shrink-0 transition-all duration-200 border-r", "bg-sidebar border-sidebar-border", collapsed ? "w-16" : "w-60")}>
      {/* Logo */}
      <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Building2 className="h-6 w-6 text-sidebar-primary shrink-0" />
            <div>
              <p className="text-sm font-bold text-sidebar-foreground leading-tight">Hagerstone</p>
              <p className="text-xs text-sidebar-foreground/60">CPS v1.0</p>
            </div>
          </div>
        )}
        {collapsed && <Building2 className="h-6 w-6 text-sidebar-primary mx-auto" />}
        <button onClick={() => setCollapsed(!collapsed)} className={cn("h-6 w-6 flex items-center justify-center rounded text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent", collapsed && "mx-auto mt-0")}>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {visible.map(item => (
          <NavLink key={item.url} to={item.url}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
              collapsed && "justify-center px-2",
              isActive ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground hover:bg-sidebar-accent/50"
            )}
            title={collapsed ? item.title : undefined}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{item.title}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className="p-3 border-t border-sidebar-border">
        {!collapsed ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <div className="h-8 w-8 rounded-full bg-sidebar-primary/20 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-sidebar-primary">{user?.name?.charAt(0)}</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-sidebar-foreground truncate">{user?.name}</p>
              </div>
            </div>
            <button onClick={async () => { await signOut(); navigate("/login"); }}
              className="w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded-md border border-sidebar-border text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors">
              <LogOut className="h-3.5 w-3.5" /> Sign Out
            </button>
          </div>
        ) : (
          <button onClick={async () => { await signOut(); navigate("/login"); }}
            className="w-full flex items-center justify-center p-2 rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
            title="Sign Out">
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
