import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Users, AlertTriangle, UserX } from "lucide-react";

/**
 * Team-wide stuck PRs for the CPS admin dashboard — the counterpart to MyStuckPRsCard.
 *
 * Admins own no requisitions, so their personal card is permanently green and told them
 * nothing. This shows the whole team: who is holding what, for how long, and what stage is
 * really blocking it.
 *
 * Backed by public.cps_team_pr_ageing(), which role-gates to it_head + management SERVER-side
 * and returns NULL to everyone else — so this component renders nothing for a procurement head
 * even if it were mounted for them. The gate is not in the UI, because hiding a card does not
 * stop the API being called.
 */

const UNASSIGNED = "Unassigned — procurement pool";

interface OwnerRow {
  owner: string;
  count: number;
  needs_them: number;
  oldest: number;
  avg: number;
  bands: Record<string, number>;
}

interface StageRow {
  stage_key: string;
  label: string;
  needs_you: boolean;
  count: number;
  oldest: number;
}

interface TeamAgeing {
  as_of: string;
  kpis: {
    stuck_count: number;
    needs_action: number;
    oldest_days: number;
    oldest_ref: string | null;
    oldest_owner: string | null;
    breach_gt7: number;
    breach_gt15: number;
    breach_gt30: number;
  };
  by_owner: OwnerRow[];
  by_stage: StageRow[];
}

function ageClasses(days: number): string {
  if (days > 60) return "bg-red-900 text-white";
  if (days > 30) return "bg-red-600 text-white";
  if (days > 15) return "bg-orange-500 text-white";
  if (days > 7) return "bg-amber-400 text-amber-950";
  return "bg-emerald-500 text-white";
}

export default function TeamStuckPRsCard() {
  const navigate = useNavigate();
  const [data, setData] = useState<TeamAgeing | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: res, error } = await supabase.rpc("cps_team_pr_ageing");
      if (cancelled) return;
      if (error) {
        console.warn("[TeamStuckPRsCard] cps_team_pr_ageing failed:", error.message);
        setData(null);
      } else {
        setData((res ?? null) as TeamAgeing | null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Skeleton className="h-32 w-full" />;

  // NULL = caller isn't it_head/management. Not an error — just not their card.
  if (!data) return null;

  const k = data.kpis;

  if (k.stuck_count === 0) {
    return (
      <Card className="border-green-200 bg-green-50/50">
        <CardContent className="flex items-center gap-2.5 py-4">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <p className="text-sm text-green-900">
            <span className="font-semibold">Team ka koi PR atka hua nahi hai.</span>{" "}
            <span className="text-green-700">Poori procurement pipeline clear hai. 🎉</span>
          </p>
        </CardContent>
      </Card>
    );
  }

  const owners = [...data.by_owner].sort((a, b) => b.count - a.count);
  const maxCount = Math.max(...owners.map((o) => o.count), 1);
  const orphans = owners.find((o) => o.owner === UNASSIGNED);

  return (
    <Card className="border-red-300 bg-red-50/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base font-semibold flex items-center gap-2 text-red-900">
            <Users className="h-4 w-4 text-red-700" />
            Team ke atke hue PRs
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1.5">
            <span className="font-semibold text-red-900 tabular-nums">{k.stuck_count} PR</span> pre-PO atke hain
            {" · "}sabse purana{" "}
            <span className="font-semibold tabular-nums">{k.oldest_days} din</span>
            {k.oldest_ref && <span className="opacity-70"> ({k.oldest_ref})</span>}
            {" · "}
            <span className="tabular-nums">{k.breach_gt30} PR 30+ din se</span>
          </p>
        </div>
        <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 shrink-0">
          {k.needs_action} action chahiye
        </Badge>
      </CardHeader>

      <CardContent className="p-0">
        {/* Who is holding what */}
        <div className="border-t border-border divide-y divide-border">
          {owners.map((o) => {
            const isOrphan = o.owner === UNASSIGNED;
            return (
              <div
                key={o.owner}
                className={`px-6 py-3 ${isOrphan ? "bg-red-100/60" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {isOrphan && <UserX className="h-3.5 w-3.5 text-red-700 shrink-0" />}
                      <span className={`text-sm font-semibold ${isOrphan ? "text-red-800" : "text-foreground"}`}>
                        {isOrphan ? "Kisi ko assign nahi" : o.owner}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {o.count} PR · avg {o.avg}d
                      </span>
                    </div>
                    {/* Share of the team's backlog */}
                    <div className="h-1.5 rounded-full bg-border overflow-hidden mt-2">
                      <div
                        className={`h-full rounded-full ${isOrphan ? "bg-red-700" : "bg-primary"}`}
                        style={{ width: `${(o.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums shrink-0 ${ageClasses(o.oldest)}`}
                  >
                    {o.oldest}d
                  </span>
                </div>
                {isOrphan && (
                  <p className="text-[11px] text-red-700 mt-1.5">
                    Ye PR kisi ke bhi dashboard par nahi dikhte — koi inhe follow nahi kar raha.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Where the whole team is blocked */}
        <div className="flex flex-wrap gap-1.5 px-6 py-3 border-t border-border">
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

        {orphans && (
          <button
            onClick={() => navigate("/requisitions")}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-red-800 bg-red-100 hover:bg-red-200 py-2.5 border-t border-border transition-colors"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {orphans.count} PR bina owner ke — assign karein
          </button>
        )}
      </CardContent>
    </Card>
  );
}
