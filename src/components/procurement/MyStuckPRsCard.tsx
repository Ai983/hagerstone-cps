import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, ArrowRight, ChevronDown, ChevronUp } from "lucide-react";

/**
 * "Aapke paas atke hue PRs" — the signed-in procurement head's OWN stuck requisitions.
 *
 * Backed by public.cps_my_pr_ageing(), which keys off auth.uid() and takes no parameters, so
 * one head can never request another's queue. Renders nothing for users who aren't in
 * cps_users, which keeps it off site-engineer / requestor dashboards.
 *
 * The stage shown is the REAL blocker, not pr.status: an RFQ sitting in 'draft' has never been
 * sent to a supplier, so a PR can read "rfq_created" while nothing has actually left the
 * building. Those rows are the ones that quietly age, so they lead the list.
 */

interface StageRow {
  stage_key: string;
  label: string;
  needs_you: boolean;
  count: number;
  oldest: number;
}

interface PrRow {
  ref: string;
  project: string | null;
  site: string | null;
  priority: string | null;
  rfq_number: string | null;
  quote_count: number;
  age_days: number;
  band: "0-7" | "8-15" | "16-30" | "31-60" | "60+";
  stage_key: string;
  stage_label: string;
  needs_you: boolean;
}

interface MyPrAgeing {
  as_of: string;
  me: { cps_user_id: string; name: string } | null;
  kpis: {
    total: number;
    needs_you: number;
    oldest_days: number;
    breach_gt7: number;
    breach_gt15: number;
    breach_gt30: number;
  };
  by_stage: StageRow[];
  items: PrRow[];
}

// Age → severity. Deliberately loud: the point of this card is that nobody can miss it.
function ageClasses(days: number): string {
  if (days > 60) return "bg-red-900 text-white";
  if (days > 30) return "bg-red-600 text-white";
  if (days > 15) return "bg-orange-500 text-white";
  if (days > 7) return "bg-amber-400 text-amber-950";
  return "bg-emerald-500 text-white";
}

export default function MyStuckPRsCard() {
  const navigate = useNavigate();
  const [data, setData] = useState<MyPrAgeing | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: res, error } = await supabase.rpc("cps_my_pr_ageing");
      if (cancelled) return;
      if (error) {
        console.warn("[MyStuckPRsCard] cps_my_pr_ageing failed:", error.message);
        setData(null);
      } else {
        setData((res ?? null) as MyPrAgeing | null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Skeleton className="h-28 w-full" />;

  // Not a CPS user (or lookup failed) → this card isn't theirs.
  if (!data?.me) return null;

  const k = data.kpis;

  if (k.total === 0) {
    return (
      <Card className="border-green-200 bg-green-50/50">
        <CardContent className="flex items-center gap-2.5 py-4">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <p className="text-sm text-green-900">
            <span className="font-semibold">Koi PR atka hua nahi hai.</span>{" "}
            <span className="text-green-700">Aapke paas kuch pending nahi — shabaash! 🎉</span>
          </p>
        </CardContent>
      </Card>
    );
  }

  const critical = k.breach_gt30 > 0;
  const shell = critical ? "border-red-300 bg-red-50/60" : "border-amber-300 bg-amber-50/50";
  const heading = critical ? "text-red-900" : "text-amber-900";
  const icon = critical ? "text-red-700" : "text-amber-700";
  const visible = expanded ? data.items : data.items.slice(0, 5);

  return (
    <Card className={shell}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className={`text-base font-semibold flex items-center gap-2 ${heading}`}>
            <AlertTriangle className={`h-4 w-4 ${icon}`} />
            Aapke atke hue PRs
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1.5">
            <span className={`font-semibold ${heading}`}>{k.needs_you} PR aapka intezaar kar rahe hain</span>
            {" · "}sabse purana <span className="font-semibold tabular-nums">{k.oldest_days} din</span>
            {k.breach_gt30 > 0 && (
              <> · <span className="text-red-700 font-semibold tabular-nums">{k.breach_gt30} PR 30+ din se</span></>
            )}
          </p>
        </div>
        <Badge
          variant="outline"
          className={critical ? "text-red-700 border-red-300 bg-red-50 shrink-0" : "text-amber-800 border-amber-300 bg-amber-50 shrink-0"}
        >
          {k.total} total
        </Badge>
      </CardHeader>

      <CardContent className="p-0">
        {/* Kis stage par atke hain — the actionable answer */}
        <div className="flex flex-wrap gap-1.5 px-6 pb-3">
          {data.by_stage.map((s) => (
            <Badge
              key={s.stage_key}
              variant="outline"
              title={`sabse purana ${s.oldest} din`}
              className={
                s.needs_you
                  ? "bg-white border-red-200 text-red-800 font-normal"
                  : "bg-white border-border text-muted-foreground font-normal"
              }
            >
              {s.label} · <span className="font-semibold tabular-nums ml-1">{s.count}</span>
            </Badge>
          ))}
        </div>

        <div className="divide-y divide-border border-t border-border">
          {visible.map((pr) => (
            <div
              key={pr.ref}
              className="flex items-center gap-3 px-6 py-2.5 cursor-pointer hover:bg-white/70 transition-colors"
              onClick={() => navigate(`/requisitions?pr=${encodeURIComponent(pr.ref)}`)}
            >
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums shrink-0 ${ageClasses(pr.age_days)}`}
              >
                {pr.age_days}d
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold text-foreground">{pr.ref}</span>
                  {pr.priority === "urgent" && (
                    <span className="text-[10px] font-bold text-red-600 uppercase">urgent</span>
                  )}
                  {pr.rfq_number && (
                    <span className="text-[10px] text-muted-foreground font-mono">{pr.rfq_number}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {pr.stage_label}
                  {pr.project && <span className="opacity-70"> · {pr.project}</span>}
                </p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </div>
          ))}
        </div>

        {data.items.length > 5 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            className="w-full rounded-none border-t border-border text-xs text-muted-foreground hover:bg-white/70"
          >
            {expanded ? (
              <>Kam dikhao <ChevronUp className="h-3.5 w-3.5 ml-1" /></>
            ) : (
              <>Saare {data.items.length} dekhein <ChevronDown className="h-3.5 w-3.5 ml-1" /></>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
