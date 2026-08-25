/**
 * Warning surface (spec §10) — the coverage work queue.
 *
 * "N vendors you trade with are not registered." Shown to procurement on the
 * dashboard, live from day one and before anything blocks, so the set that
 * Phase B would refuse a PO to is visible and can be cleared first. Renders
 * nothing when the queue is empty or the viewer is not procurement.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowRight } from "lucide-react";
import {
  type UnregisteredTradingVendor, fetchUnregisteredTradingVendors,
} from "@/lib/vendorRegistration";

export default function UnregisteredVendorsBanner() {
  const { canManageSuppliers } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<UnregisteredTradingVendor[] | null>(null);

  useEffect(() => {
    if (!canManageSuppliers) return;
    fetchUnregisteredTradingVendors()
      .then(setRows)
      // Advisory surface — fail silent (e.g. before the Phase A migration is
      // applied the view does not exist yet); never nag procurement with a toast.
      .catch(() => setRows([]));
  }, [canManageSuppliers]);

  if (!canManageSuppliers || !rows || rows.length === 0) return null;

  const shown = rows.slice(0, 8);
  const more = rows.length - shown.length;

  return (
    <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10">
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {rows.length} vendor{rows.length === 1 ? "" : "s"} you trade with {rows.length === 1 ? "is" : "are"} not registered
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              These vendors have purchase orders but no approved registration. Register them so their
              future POs are not blocked once enforcement is turned on.
            </p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0"
                  onClick={() => navigate("/vendor-registration")}>
            Open portal<ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        <div className="border border-border rounded-lg divide-y divide-border bg-background">
          {shown.map((v) => (
            <div key={v.id} className="flex items-center gap-3 p-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{v.name ?? "(unnamed)"}</div>
                <div className="text-xs text-muted-foreground">
                  {v.po_count} PO{v.po_count === 1 ? "" : "s"}
                  {v.city ? ` · ${v.city}` : ""}
                  {v.registration_status !== "unregistered" ? ` · ${v.registration_status.replace(/_/g, " ")}` : ""}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => navigate("/vendor-registration")}>
                Register
              </Button>
            </div>
          ))}
        </div>

        {more > 0 && (
          <div className="text-xs text-muted-foreground">
            <Badge variant="secondary">+{more} more</Badge> not shown.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
