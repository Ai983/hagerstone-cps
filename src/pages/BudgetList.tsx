// src/pages/BudgetList.tsx
import { useState, useEffect, useMemo, Fragment } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Loader2, Building2, FileDown } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ── Types ──────────────────────────────────────────────────────────────────
interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  gst_percent: number;
  total_value: number;
  sort_order: number;
}

// A payment-schedule tranche. Finance pays in the separate expense app, which
// updates these rows (status → 'paid', paid_amount, paid_at). This — NOT the PO
// header finance_* columns — is the live source of truth for tranche-model POs,
// matching the badge logic on the Purchase Orders page.
interface Tranche {
  amount: number | null;
  paid_amount: number | null;
  status: string | null;
  paid_at: string | null;
}

interface PoRecord {
  id: string;
  po_number: string;
  ship_to_address: string;
  grand_total: number;
  status: string;
  finance_payment_status: string | null;
  finance_paid_amount: number | null;
  finance_balance_due: number | null;
  finance_paid_at: string | null;
  payment_terms_type: string | null;
  cps_suppliers: { id: string; name: string } | null;
  cps_purchase_requisitions: { project_site: string; project_code: string } | null;
  cps_po_line_items: LineItem[];
  cps_po_payment_schedules: Tranche[];
}

interface VendorGroup {
  supplierName: string;
  pos: PoRecord[];
  subtotal: number;
  paidTotal: number;
  balance: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const inr = (v: number) =>
  '₹' + Math.round(v).toLocaleString('en-IN');

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

interface FinanceState {
  paid: number;
  balance: number;
  status: 'paid' | 'partial' | 'awaiting';
  paidAt: string | null;
  /** True once Finance has recorded its first payment — the rule for appearing on this list. */
  qualifies: boolean;
}

// Single source of truth for a PO's payment state on the Budget List.
//
// When Finance marks a PO paid in the expense app there are two write-back paths,
// chosen by the PO's payment model — so we honour BOTH and take the stronger signal,
// guaranteeing a PO surfaces on its first payment no matter which path fired:
//  • Tranche-model POs → the expense app flips cps_po_payment_schedules rows to 'paid'.
//  • Legacy / header POs → cps_sync_payment_from_finance writes the PO header finance_* cols.
function financeStateOf(po: PoRecord): FinanceState {
  const total = Number(po.grand_total ?? 0);
  const tr = po.cps_po_payment_schedules ?? [];

  // Signal A — payment schedule (tranche-model POs)
  const tranchePaid = tr.reduce(
    (s, t) => (t.status === 'paid' ? s + Number(t.paid_amount ?? t.amount ?? 0) : s),
    0,
  );
  const allSettled = tr.length > 0 && tr.every(t => t.status === 'paid' || t.status === 'waived');
  const paidDates = tr.filter(t => t.status === 'paid' && t.paid_at).map(t => t.paid_at as string);
  const tranchePaidAt = paidDates.length ? paidDates.reduce((a, b) => (a > b ? a : b)) : null;

  // Signal B — PO header (legacy / header-sync POs)
  const headerPaid = Number(po.finance_paid_amount ?? 0);

  const paid = Math.max(tranchePaid, headerPaid);
  const paidAt = tranchePaidAt ?? po.finance_paid_at ?? null;

  const status: FinanceState['status'] =
    paid <= 0
      ? 'awaiting'
      : allSettled || po.finance_payment_status === 'paid' || paid >= total - 0.01
        ? 'paid'
        : 'partial';

  return { paid, balance: Math.max(0, total - paid), status, paidAt, qualifies: paid > 0 };
}

function deriveStatus(po: PoRecord): 'paid' | 'partial' | 'awaiting' {
  return financeStateOf(po).status;
}

// Deduplicate line items that were double-inserted (same description + rate + gst)
function dedupeItems(items: LineItem[]): LineItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${(item.description ?? '').trim()}|${item.rate}|${item.gst_percent}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function StatusBadge({ po }: { po: PoRecord }) {
  const s = deriveStatus(po);
  if (s === 'paid')
    return <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px] font-medium">Paid</Badge>;
  if (s === 'partial')
    return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] font-medium">Partial</Badge>;
  return <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] font-medium">Awaiting</Badge>;
}

// Resolve the canonical project name for a PO — prefer project_code, fall
// back to the free-text address so a PO without a project link is never lost.
function projectKeyOf(po: PoRecord): string {
  return (po.cps_purchase_requisitions?.project_code ?? '').trim() || po.ship_to_address || 'Unassigned';
}

// ── Component ──────────────────────────────────────────────────────────────
export default function BudgetList() {
  const [selectedSite, setSelectedSite] = useState<string>('');
  const [allPos, setAllPos] = useState<PoRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Load all paid POs once ─────────────────────────────────────────────
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const { data, error } = await supabase
        .from('cps_purchase_orders')
        .select(`
          id, po_number, ship_to_address, grand_total, status,
          finance_payment_status, finance_paid_amount, finance_balance_due, finance_paid_at,
          payment_terms_type,
          cps_suppliers(id, name),
          cps_purchase_requisitions(project_site, project_code),
          cps_po_line_items(id, description, quantity, unit, rate, gst_percent, total_value, sort_order),
          cps_po_payment_schedules(amount, paid_amount, status, paid_at)
        `)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: true });

      if (error) { toast.error('Failed to load budget data'); setLoading(false); return; }
      // A PO appears once Finance records its first payment — for tranche POs that means
      // any tranche is paid; for legacy POs, the header finance_paid_amount > 0.
      const paidPos = ((data ?? []) as unknown as PoRecord[]).filter(po => financeStateOf(po).qualifies);
      setAllPos(paidPos);
      setLoading(false);
    }
    loadData();
  }, []);

  // ── Distinct projects (grouped by canonical project name) ──────────────
  const sites = useMemo(() => {
    const seen = new Set<string>();
    const list: { value: string; label: string }[] = [];
    allPos.forEach(po => {
      const key = projectKeyOf(po);
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ value: key, label: key });
    });
    return list.sort((a, b) => a.label.localeCompare(b.label));
  }, [allPos]);

  // ── POs for the selected project ───────────────────────────────────────
  const pos = useMemo(
    () => (selectedSite ? allPos.filter(po => projectKeyOf(po) === selectedSite) : []),
    [allPos, selectedSite]
  );
  const sitesLoading = loading;

  // ── Group by vendor ────────────────────────────────────────────────────
  const vendorGroups = useMemo<VendorGroup[]>(() => {
    const map = new Map<string, VendorGroup>();
    pos.forEach(po => {
      const name = po.cps_suppliers?.name ?? po.po_number;
      const key = po.cps_suppliers?.id ?? name;
      if (!map.has(key)) {
        map.set(key, { supplierName: name, pos: [], subtotal: 0, paidTotal: 0, balance: 0 });
      }
      const g = map.get(key)!;
      const st = financeStateOf(po);
      g.pos.push(po);
      g.subtotal += Number(po.grand_total ?? 0);
      g.paidTotal += st.paid;
      g.balance += st.balance;
    });
    return Array.from(map.values()).sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  }, [pos]);

  const summary = useMemo(() => ({
    totalValue:   vendorGroups.reduce((s, g) => s + g.subtotal,   0),
    totalPaid:    vendorGroups.reduce((s, g) => s + g.paidTotal,  0),
    totalBalance: vendorGroups.reduce((s, g) => s + g.balance,    0),
    vendorCount:  vendorGroups.length,
    poCount:      pos.length,
  }), [vendorGroups, pos]);

  const siteLabel = sites.find(s => s.value === selectedSite)?.label ?? selectedSite;
  let serial = 0;

  // ── Download the current site's budget as a PDF ─────────────────────────
  function downloadPdf() {
    if (!selectedSite || vendorGroups.length === 0) return;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();   // 297mm
    const M = 10;                                  // page margin
    const brown = [101, 56, 35] as [number, number, number];
    const gold = [212, 168, 85] as [number, number, number];
    const subtleFill = [245, 240, 235] as [number, number, number];
    // jsPDF's Helvetica has no ₹ glyph — use "Rs" so numbers render & measure correctly
    const rs = (v: number) => 'Rs ' + Math.round(v).toLocaleString('en-IN');

    // Header band
    doc.setFillColor(...brown);
    doc.rect(0, 0, W, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('HAGERSTONE INTERNATIONAL', M, 9);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Budget List', M, 15);
    doc.setFontSize(8);
    doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, W - M, 9, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    // Site name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(siteLabel, M, 30, { maxWidth: W - 2 * M });

    // Summary line
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      `Total PO Value: ${rs(summary.totalValue)}     Paid: ${rs(summary.totalPaid)}     Balance Due: ${rs(summary.totalBalance)}     |     Vendors: ${summary.vendorCount}     POs: ${summary.poCount}`,
      M, 37
    );

    // Build table body grouped by vendor with subtotal rows
    const body: any[] = [];
    let sn = 0;
    vendorGroups.forEach(group => {
      const rows: { li: LineItem; po: PoRecord }[] = [];
      group.pos.forEach(po => {
        dedupeItems([...(po.cps_po_line_items ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
          .forEach(li => rows.push({ li, po }));
      });
      rows.forEach(({ li, po }, idx) => {
        sn++;
        const amtWithGst = Number(li.total_value ?? 0) * (1 + Number(li.gst_percent ?? 0) / 100);
        body.push([
          String(sn),
          idx === 0 ? group.supplierName : '"',
          li.description || '—',
          Number(li.quantity ?? 0).toLocaleString('en-IN'),
          li.unit || '—',
          rs(Number(li.rate ?? 0)),
          `${Number(li.gst_percent ?? 0)}%`,
          rs(amtWithGst),
          po.po_number,
          deriveStatus(po),
          fmtDate(financeStateOf(po).paidAt),
        ]);
      });
      // Vendor subtotal row
      body.push([
        { content: `${group.supplierName} — Total`, colSpan: 7, styles: { fontStyle: 'bold', fillColor: subtleFill } },
        { content: rs(group.subtotal), styles: { fontStyle: 'bold', halign: 'right', fillColor: subtleFill } },
        { content: `Paid ${rs(group.paidTotal)}${group.balance > 0.5 ? ` | Due ${rs(group.balance)}` : ''}`, colSpan: 3, styles: { fillColor: subtleFill, fontStyle: 'bold' } },
      ]);
    });
    // Grand total row
    body.push([
      { content: 'GRAND TOTAL', colSpan: 7, styles: { fontStyle: 'bold', fillColor: gold, textColor: brown } },
      { content: rs(summary.totalValue), styles: { fontStyle: 'bold', halign: 'right', fillColor: gold, textColor: brown } },
      { content: `Paid ${rs(summary.totalPaid)}${summary.totalBalance > 0.5 ? ` | Due ${rs(summary.totalBalance)}` : ''}`, colSpan: 3, styles: { fillColor: gold, textColor: brown, fontStyle: 'bold' } },
    ]);

    autoTable(doc, {
      startY: 42,
      head: [['S.No', 'Vendor Name', 'Item', 'Qty', 'Unit', 'Rate', 'GST%', 'Amount', 'PO #', 'Status', 'Paid On']],
      body,
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 1.5, overflow: 'linebreak', valign: 'middle', lineColor: [220, 215, 210], lineWidth: 0.1 },
      headStyles: { fillColor: brown, textColor: 255, fontSize: 8, fontStyle: 'bold', halign: 'center' },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },  // S.No
        1: { cellWidth: 38 },                      // Vendor
        2: { cellWidth: 46 },                      // Item
        3: { cellWidth: 12, halign: 'right' },    // Qty
        4: { cellWidth: 12, halign: 'center' },   // Unit
        5: { cellWidth: 26, halign: 'right' },    // Rate
        6: { cellWidth: 12, halign: 'right' },    // GST%
        7: { cellWidth: 32, halign: 'right' },    // Amount
        8: { cellWidth: 34 },                      // PO #
        9: { cellWidth: 21, halign: 'center' },   // Status
        10: { cellWidth: 22, halign: 'center' },  // Paid On
      },
      margin: { left: M, right: M },
    });

    const safeName = siteLabel.replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
    doc.save(`BudgetList_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Budget List</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Site-wise PO spend tracker — auto-updated from Finance payments
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-72">
            {sitesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground h-10">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading sites…
              </div>
            ) : (
              <Select value={selectedSite} onValueChange={setSelectedSite}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a site / project" />
                </SelectTrigger>
                <SelectContent>
                  {sites.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No sites with payments yet
                    </div>
                  )}
                  {sites.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <Button
            variant="outline"
            onClick={downloadPdf}
            disabled={!selectedSite || vendorGroups.length === 0}
          >
            <FileDown className="h-4 w-4 mr-2" />
            Download PDF
          </Button>
        </div>
      </div>

      {/* ── Empty state ── */}
      {!selectedSite && (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Building2 className="h-14 w-14 mb-4 opacity-25" />
          <p className="text-sm font-medium">Select a site to view its budget list</p>
          <p className="text-xs mt-1 opacity-70">Sites appear here once the first payment is recorded in Finance</p>
        </div>
      )}

      {selectedSite && (
        <>
          {/* ── Summary cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Total PO Value',  value: inr(summary.totalValue),   color: 'text-foreground' },
              { label: 'Total Paid',      value: inr(summary.totalPaid),    color: 'text-green-700' },
              { label: 'Balance Due',     value: inr(summary.totalBalance), color: 'text-red-600' },
              { label: 'Vendors',         value: String(summary.vendorCount), color: 'text-foreground' },
              { label: 'POs',            value: String(summary.poCount),    color: 'text-foreground' },
            ].map(card => (
              <Card key={card.label}>
                <CardContent className="pt-4 pb-3">
                  <div className="text-xs text-muted-foreground">{card.label}</div>
                  <div className={`text-xl font-bold mt-1 ${card.color}`}>{card.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ── Site title ── */}
          <div className="text-center py-1">
            <div className="text-base font-semibold text-foreground">{siteLabel}</div>
            {selectedSite !== siteLabel && (
              <div className="text-xs text-muted-foreground mt-0.5">{selectedSite}</div>
            )}
          </div>

          {/* ── Loading ── */}
          {loading && (
            <div className="flex justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* ── Empty data ── */}
          {!loading && vendorGroups.length === 0 && (
            <div className="text-center py-16 text-sm text-muted-foreground">
              No paid POs found for this site.
            </div>
          )}

          {/* ── Budget Table ── */}
          {!loading && vendorGroups.length > 0 && (
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-muted/60 border-b">
                    {['S.No', 'Vendor Name', 'Items', 'Qty', 'Unit', 'Rate', 'GST%', 'Amount (incl. GST)', 'PO #', 'Status', 'Paid On'].map(h => (
                      <th
                        key={h}
                        className={`px-3 py-2.5 font-semibold text-xs text-muted-foreground whitespace-nowrap
                          ${['Qty','Rate','GST%','Amount (incl. GST)'].includes(h) ? 'text-right' : 'text-left'}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vendorGroups.map((group, gi) => {
                    // Flatten all line items across vendor's POs, deduped per PO
                    const allRows: { li: LineItem; po: PoRecord }[] = [];
                    group.pos.forEach(po => {
                      const items = dedupeItems(
                        [...(po.cps_po_line_items ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                      );
                      items.forEach(li => allRows.push({ li, po }));
                    });

                    return (
                      <Fragment key={group.supplierName}>
                        {/* ── Line item rows ── */}
                        {allRows.map(({ li, po }, idx) => {
                          serial++;
                          const amtWithGst = Number(li.total_value ?? 0) * (1 + Number(li.gst_percent ?? 0) / 100);
                          return (
                            <tr
                              key={`${po.id}-${li.id}-${idx}`}
                              className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'}
                            >
                              <td className="px-3 py-2 text-muted-foreground tabular-nums text-xs">{serial}</td>
                              <td className="px-3 py-2 font-medium text-foreground">
                                {idx === 0 ? group.supplierName : <span className="text-muted-foreground text-xs">〃</span>}
                              </td>
                              <td className="px-3 py-2 text-foreground">{li.description || '—'}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{Number(li.quantity ?? 0).toLocaleString('en-IN')}</td>
                              <td className="px-3 py-2 text-muted-foreground">{li.unit || '—'}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{inr(Number(li.rate ?? 0))}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{Number(li.gst_percent ?? 0)}%</td>
                              <td className="px-3 py-2 text-right font-medium tabular-nums">{inr(amtWithGst)}</td>
                              <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{po.po_number}</td>
                              <td className="px-3 py-2"><StatusBadge po={po} /></td>
                              <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(financeStateOf(po).paidAt)}</td>
                            </tr>
                          );
                        })}

                        {/* ── Vendor subtotal ── */}
                        <tr className="bg-primary/5 border-t border-b border-primary/10">
                          <td className="px-3 py-2.5" colSpan={2}>
                            <span className="text-xs font-semibold text-primary">{group.supplierName} — Total</span>
                          </td>
                          <td className="px-3 py-2.5" colSpan={5} />
                          <td className="px-3 py-2.5 text-right font-bold tabular-nums">{inr(group.subtotal)}</td>
                          <td className="px-3 py-2.5" colSpan={3}>
                            <span className="text-xs text-green-700 font-medium">Paid: {inr(group.paidTotal)}</span>
                            {group.balance > 0.5 && (
                              <span className="text-xs text-red-600 font-medium ml-3">Due: {inr(group.balance)}</span>
                            )}
                          </td>
                        </tr>

                        {/* Spacer between vendors */}
                        {gi < vendorGroups.length - 1 && (
                          <tr className="bg-muted/40">
                            <td colSpan={11} className="py-1" />
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}

                  {/* ── Grand total ── */}
                  <tr className="bg-primary/10 border-t-2 border-primary/20">
                    <td className="px-3 py-3" colSpan={2}>
                      <span className="font-bold text-foreground">GRAND TOTAL</span>
                    </td>
                    <td className="px-3 py-3" colSpan={5} />
                    <td className="px-3 py-3 text-right font-bold text-base tabular-nums">{inr(summary.totalValue)}</td>
                    <td className="px-3 py-3" colSpan={3}>
                      <span className="text-sm text-green-700 font-semibold">Paid: {inr(summary.totalPaid)}</span>
                      {summary.totalBalance > 0.5 && (
                        <span className="text-sm text-red-600 font-semibold ml-3">Due: {inr(summary.totalBalance)}</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
