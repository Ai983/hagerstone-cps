import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

import { Building2, CheckCircle, Clock, XCircle } from "lucide-react";

type VendorReg = {
  id: string;
  company_name: string | null;
  status: string | null;
  rejection_reason: string | null;
  categories: string[] | null;
  regions: string[] | null;
  submitted_at: string | null;
  created_at: string | null;
};

const formatDate = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export default function VendorStatus() {
  const [searchParams] = useSearchParams();
  const emailParam = searchParams.get("email") ?? "";

  const [email, setEmail] = useState(emailParam);
  const [loading, setLoading] = useState(false);
  const [registration, setRegistration] = useState<VendorReg | null>(null);
  const [searched, setSearched] = useState(false);

  const lookup = async (lookupEmail?: string) => {
    const target = (lookupEmail ?? email).trim().toLowerCase();
    if (!target) {
      toast.error("Please enter your email");
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const { data, error } = await supabase
        .from("cps_vendor_registrations")
        .select("id,company_name,status,rejection_reason,categories,regions,submitted_at,created_at")
        .eq("email", target)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw error;
      setRegistration((data && data.length > 0) ? data[0] as VendorReg : null);
    } catch (e: any) {
      toast.error(e?.message || "Failed to check status");
      setRegistration(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (emailParam) {
      setEmail(emailParam);
      lookup(emailParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailParam]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-lg w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Vendor Registration Status</h1>
          <p className="text-muted-foreground text-sm">Hagerstone International (P) Ltd</p>
        </div>

        {/* Email input */}
        <Card>
          <CardContent className="py-6 space-y-4">
            <div className="space-y-2">
              <Label>Email used during registration</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vendor@example.com"
                onKeyDown={(e) => e.key === "Enter" && lookup()}
              />
            </div>
            <Button className="w-full" onClick={() => lookup()} disabled={loading}>
              {loading ? "Checking..." : "Check Status"}
            </Button>
          </CardContent>
        </Card>

        {/* Results */}
        {loading && (
          <Card><CardContent className="py-6 space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
          </CardContent></Card>
        )}

        {!loading && searched && !registration && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No registration found for this email address.
            </CardContent>
          </Card>
        )}

        {!loading && registration && (
          <>
            {/* Status card */}
            {registration.status === "pending" && (
              <Card className="border-amber-200">
                <CardContent className="py-6 flex items-start gap-4">
                  <Clock className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-amber-800">Under Review</h3>
                    <p className="text-sm text-amber-700 mt-1">We'll respond within 3 working days.</p>
                  </div>
                </CardContent>
              </Card>
            )}
            {registration.status === "approved" && (
              <Card className="border-green-200">
                <CardContent className="py-6 flex items-start gap-4">
                  <CheckCircle className="h-6 w-6 text-green-600 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-green-800">Approved!</h3>
                    <p className="text-sm text-green-700 mt-1">You are now a registered Hagerstone supplier. Our team will contact you.</p>
                  </div>
                </CardContent>
              </Card>
            )}
            {registration.status === "rejected" && (
              <Card className="border-red-200">
                <CardContent className="py-6 flex items-start gap-4">
                  <XCircle className="h-6 w-6 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-red-800">Application Not Approved</h3>
                    {registration.rejection_reason && (
                      <p className="text-sm text-red-700 mt-1">Reason: {registration.rejection_reason}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Summary */}
            <Card>
              <CardContent className="py-6 space-y-3">
                <div className="text-sm">
                  <span className="text-muted-foreground">Company:</span>{" "}
                  <span className="font-medium">{registration.company_name ?? "—"}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Submitted:</span>{" "}
                  <span className="font-medium">{formatDate(registration.submitted_at ?? registration.created_at)}</span>
                </div>
                {(registration.categories ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(registration.categories ?? []).map((c) => (
                      <Badge key={c} className="bg-primary/10 text-primary border-0 text-xs">{c}</Badge>
                    ))}
                  </div>
                )}
                {(registration.regions ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(registration.regions ?? []).map((r) => (
                      <Badge key={r} className="bg-muted text-muted-foreground border-0 text-xs">{r}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
