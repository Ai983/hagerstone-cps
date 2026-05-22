import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useSupplierDetailForRfq } from "@/hooks/useSupplierDetailForRfq";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  rfqId: string;
  supplierId: string | null;
  onClose: () => void;
  onAddToRfq: (supplierId: string) => Promise<void> | void;
  onSkip?: (supplierId: string) => void;
}

const formatInr = (n: number | null | undefined) => {
  if (n == null) return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  const opts: Intl.NumberFormatOptions = Number.isInteger(num)
    ? { maximumFractionDigits: 0 }
    : { maximumFractionDigits: 2 };
  return `₹${num.toLocaleString("en-IN", opts)}`;
};

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "dd MMM yyyy");
  } catch {
    return "—";
  }
};

const TrendCell = ({ trend }: { trend: "up" | "down" | "stable" | "new" | null }) => {
  if (trend === "up") {
    return (
      <span className="inline-flex items-center gap-0.5 text-destructive text-xs">
        <TrendingUp className="h-3.5 w-3.5" /> Up
      </span>
    );
  }
  if (trend === "down") {
    return (
      <span className="inline-flex items-center gap-0.5 text-primary text-xs">
        <TrendingDown className="h-3.5 w-3.5" /> Down
      </span>
    );
  }
  if (trend === "stable") {
    return (
      <span className="inline-flex items-center gap-0.5 text-muted-foreground text-xs">
        <Minus className="h-3.5 w-3.5" /> Stable
      </span>
    );
  }
  if (trend === "new") {
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0">NEW</Badge>;
  }
  return <span className="text-muted-foreground">—</span>;
};

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className="text-foreground break-words">{value || "—"}</span>
    </div>
  );
}

export function SupplierDetailDialog({
  rfqId,
  supplierId,
  onClose,
  onAddToRfq,
  onSkip,
}: Props) {
  const { canManageSuppliers } = useAuth();
  const [adding, setAdding] = useState(false);
  const open = !!supplierId;

  const { data, isLoading, isError, error, refetch } = useSupplierDetailForRfq(
    open ? rfqId : undefined,
    open ? supplierId ?? undefined : undefined,
  );

  const dangerRisks = (data?.risks ?? []).filter((r) => r.level === "danger");
  const hasDanger = dangerRisks.length > 0;

  const handleAdd = async () => {
    if (!supplierId || !data) return;
    setAdding(true);
    try {
      await onAddToRfq(supplierId);
      toast.success(`Added ${data.supplier.name} to RFQ`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Failed to add supplier");
    } finally {
      setAdding(false);
    }
  };

  const handleSkip = () => {
    if (supplierId && onSkip) onSkip(supplierId);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {isLoading || !data ? (
              <Skeleton className="h-5 w-48" />
            ) : (
              <>
                <span>{data.supplier.name}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  Score {Math.round(Number(data.match.score) || 0).toLocaleString("en-IN")}
                </span>
                {data.match.is_fresh && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">FRESH</Badge>
                )}
                {data.match.win_rate_review_flag && (
                  <Badge className="bg-destructive/10 text-destructive border-destructive/30 border text-[10px] px-1.5 py-0">
                    ⚠ Win-rate {Math.round(Number(data.supplier.win_rate) || 0)}% — review
                  </Badge>
                )}
              </>
            )}
          </DialogTitle>
          {data && (
            <DialogDescription className="text-xs">
              Suggested for RFQ {data.rfq.rfq_number}
              {data.rfq.target_category ? ` · ${data.rfq.target_category}` : ""}
            </DialogDescription>
          )}
        </DialogHeader>

        {isError ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn't load supplier details</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-3">
              <span className="text-xs">{(error as Error)?.message ?? "Unknown error"}</span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
            </AlertDescription>
          </Alert>
        ) : isLoading || !data ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : (
          <div className="space-y-5 text-sm">
            {/* Why this supplier was suggested */}
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">
                Why this supplier was suggested
              </h3>
              {data.why_suggested_bullets.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No automatic match reasons — supplier was likely added manually.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {data.why_suggested_bullets.map((b, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="text-primary mt-0.5">•</span>
                      <span className="text-foreground">{b.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Past rates on this RFQ's items */}
            {data.rate_history_on_rfq_items.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-2">
                  Past rates from this supplier for materials on this RFQ
                </h3>
                <div className="rounded-md border border-border/60 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Material</TableHead>
                        <TableHead className="text-right">Last rate</TableHead>
                        <TableHead>Trend</TableHead>
                        <TableHead className="text-right">Best</TableHead>
                        <TableHead className="text-right">Avg</TableHead>
                        <TableHead>Quoted on</TableHead>
                        <TableHead className="text-right">Times</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.rate_history_on_rfq_items.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{r.item_name}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatInr(r.last_rate)}</TableCell>
                          <TableCell><TrendCell trend={r.rate_trend} /></TableCell>
                          <TableCell className="text-right tabular-nums">{formatInr(r.best_rate)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatInr(r.avg_rate)}</TableCell>
                          <TableCell className="text-muted-foreground">{formatDate(r.last_date)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.quote_count ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}

            {/* Recent activity */}
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">Recent activity</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                <Tile label="Total quotes" value={String(data.recent_activity.total_quotes ?? 0)} />
                <Tile label="Total POs" value={String(data.recent_activity.total_pos ?? 0)} />
                <Tile label="Last PO" value={formatDate(data.recent_activity.last_po_date)} />
                <Tile
                  label="Last invited"
                  value={data.supplier.last_invited_at ? formatDate(data.supplier.last_invited_at) : "Never"}
                />
              </div>
              {data.recent_activity.rfqs_last_5.length > 0 && (
                <div className="rounded-md border border-border/60 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>RFQ</TableHead>
                        <TableHead>Invited</TableHead>
                        <TableHead>Response</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recent_activity.rfqs_last_5.map((r) => (
                        <TableRow key={r.rfq_number}>
                          <TableCell className="font-medium">{r.rfq_number}</TableCell>
                          <TableCell className="text-muted-foreground">{formatDate(r.invited_at)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] capitalize px-1.5 py-0">
                              {r.response_status ?? "pending"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            {/* Warnings & risks */}
            {data.risks.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-2">Things to review</h3>
                <div className="space-y-2">
                  {data.risks.map((r, i) => (
                    <Alert key={i} variant={r.level === "danger" ? "destructive" : "default"}>
                      <AlertDescription>{r.message}</AlertDescription>
                    </Alert>
                  ))}
                </div>
              </section>
            )}

            {/* Contact & coverage */}
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">Contact &amp; coverage</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <Row label="Phone" value={data.supplier.phone} />
                <Row label="Email" value={data.supplier.email} />
                <Row label="City" value={data.supplier.city} />
                <Row label="Status" value={data.supplier.status} />
              </div>
              {(data.supplier.categories?.length ?? 0) > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">Categories</p>
                  <div className="flex gap-1 flex-wrap">
                    {data.supplier.categories.map((c) => (
                      <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(data.supplier.regions?.length ?? 0) > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">Regions</p>
                  <div className="flex gap-1 flex-wrap">
                    {data.supplier.regions.map((r) => (
                      <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {onSkip && data && (
            <Button variant="ghost" onClick={handleSkip} disabled={adding}>
              Skip
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={adding}>
            Close
          </Button>
          {canManageSuppliers && data && (
            hasDanger ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>
                      <Button disabled>Add to RFQ</Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {dangerRisks.map((r) => r.message).join("; ") || "Blocked by a critical risk"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <Button onClick={handleAdd} disabled={adding}>
                {adding ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Adding…</>
                ) : (
                  "Add to RFQ"
                )}
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
