// src/components/procurement/TranchePlanEditor.tsx
//
// Fully-CONTROLLED tranche plan editor for SPEC-PAY-01.
// The parent owns the `value` array and `onChange`; this component holds NO
// internal prop-synced state (no useState(prop)+useEffect) — it derives the
// rendered rows directly from `value`, per the CLAUDE.md React State Patterns.
//
// The array it produces is the canonical shape consumed by the
// cps.cps_generate_tranches(p_po_id, p_tranches) DB function:
//   [{ milestone_name, basis:'percent'|'fixed'|'balance', value, trigger_type, trigger_offset_days }]

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────
export type TrancheBasis = 'percent' | 'fixed' | 'balance';
export type TriggerType =
  | 'advance_on_po'
  | 'before_dispatch'
  | 'on_dispatch_lr'
  | 'on_delivery_grn'
  | 'credit_days_from_invoice'
  | 'credit_days_from_grn';

export interface Tranche {
  milestone_name: string;
  basis: TrancheBasis;
  value?: number | null;           // percent (if basis=percent) or amount (if basis=fixed); ignored for balance
  trigger_type: TriggerType;
  trigger_offset_days?: number | null;
}

const TRIGGERS: { value: TriggerType; label: string; isCredit: boolean }[] = [
  { value: 'advance_on_po',            label: 'Advance (PO ke saath)',       isCredit: false },
  { value: 'before_dispatch',          label: 'Dispatch se pehle',           isCredit: false },
  { value: 'on_dispatch_lr',           label: 'Dispatch pe (LR/Bilty)',      isCredit: false },
  { value: 'on_delivery_grn',          label: 'Delivery pe (maal aane par)', isCredit: false },
  { value: 'credit_days_from_invoice', label: 'Udhaar (invoice se din)',     isCredit: true  },
  { value: 'credit_days_from_grn',     label: 'Udhaar (delivery se din)',    isCredit: true  },
];

const isCreditTrigger = (t: TriggerType) => TRIGGERS.find((x) => x.value === t)?.isCredit ?? false;

// ── Presets ──────────────────────────────────────────────────────────────
const PRESETS: { label: string; build: () => Tranche[] }[] = [
  { label: 'Poora Advance (100%)', build: () => [
    { milestone_name: 'Advance', basis: 'percent', value: 100, trigger_type: 'advance_on_po' },
  ] },
  { label: 'Delivery pe Poora (100%)', build: () => [
    { milestone_name: 'Delivery pe', basis: 'percent', value: 100, trigger_type: 'on_delivery_grn' },
  ] },
  { label: 'Udhaar 30 din (100%)', build: () => [
    { milestone_name: 'Udhaar 30 din', basis: 'percent', value: 100, trigger_type: 'credit_days_from_invoice', trigger_offset_days: 30 },
  ] },
  { label: '50% Advance + 50% Delivery', build: () => [
    { milestone_name: 'Advance 50%', basis: 'percent', value: 50, trigger_type: 'advance_on_po' },
    { milestone_name: 'Baaki delivery pe', basis: 'balance', trigger_type: 'on_delivery_grn' },
  ] },
  { label: '75% Advance + 25% Delivery', build: () => [
    { milestone_name: 'Advance 75%', basis: 'percent', value: 75, trigger_type: 'advance_on_po' },
    { milestone_name: 'Baaki delivery pe', basis: 'balance', trigger_type: 'on_delivery_grn' },
  ] },
];

// ── Amount computation (mirrors cps_generate_tranches) ─────────────────────
export function computeAmounts(value: Tranche[], total: number): number[] {
  let allocated = 0;
  return value.map((t) => {
    let amt = 0;
    if (t.basis === 'percent') amt = Math.round((total * (Number(t.value) || 0)) / 100 * 100) / 100;
    else if (t.basis === 'fixed') amt = Number(t.value) || 0;
    else amt = Math.round((total - allocated) * 100) / 100; // balance
    allocated += amt;
    return amt;
  });
}

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Component ──────────────────────────────────────────────────────────────
interface Props {
  totalAmount: number;
  value: Tranche[];
  onChange: (next: Tranche[]) => void;
}

export function TranchePlanEditor({ totalAmount, value, onChange }: Props) {
  const amounts = computeAmounts(value, totalAmount);
  const allocated = amounts.reduce((s, a) => s + a, 0);
  const overAllocated = allocated - totalAmount > 0.01;
  const underAllocated = totalAmount - allocated > 0.01 && value.length > 0;

  const update = (i: number, patch: Partial<Tranche>) =>
    onChange(value.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const addRow = () =>
    onChange([...value, { milestone_name: `Installment ${value.length + 1}`, basis: 'percent', value: 0, trigger_type: 'on_delivery_grn' }]);
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Payment Plan (Installments / Kist)</Label>
        <span className="text-xs text-muted-foreground">PO total: {fmt(totalAmount)}</span>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button key={p.label} type="button" variant="outline" size="sm"
            className="text-xs h-7" onClick={() => onChange(p.build())}>
            {p.label}
          </Button>
        ))}
      </div>

      {/* Rows */}
      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">
          Abhi koi installment nahi — upar se ek preset chuno ya neeche row add karo. (Optional — khali bhi chhod sakte ho.)
        </p>
      ) : (
        <div className="space-y-2">
          {value.map((t, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center rounded-lg border border-border p-2">
              <Input
                className="col-span-3 h-8 text-xs"
                placeholder="Installment ka naam"
                value={t.milestone_name}
                onChange={(e) => update(i, { milestone_name: e.target.value })}
              />
              <Select value={t.basis} onValueChange={(v) => update(i, { basis: v as TrancheBasis })}>
                <SelectTrigger className="col-span-2 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">%</SelectItem>
                  <SelectItem value="fixed">Fixed ₹</SelectItem>
                  <SelectItem value="balance">Balance (bacha)</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="col-span-1 h-8 text-xs"
                type="number"
                disabled={t.basis === 'balance'}
                value={t.basis === 'balance' ? '' : (t.value ?? '')}
                onChange={(e) => update(i, { value: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <Select value={t.trigger_type} onValueChange={(v) => update(i, { trigger_type: v as TriggerType })}>
                <SelectTrigger className="col-span-3 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGERS.map((tr) => (
                    <SelectItem key={tr.value} value={tr.value} className="text-xs">{tr.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isCreditTrigger(t.trigger_type) ? (
                <Input
                  className="col-span-1 h-8 text-xs"
                  type="number"
                  placeholder="days"
                  value={t.trigger_offset_days ?? ''}
                  onChange={(e) => update(i, { trigger_offset_days: e.target.value === '' ? null : Number(e.target.value) })}
                />
              ) : (
                <span className="col-span-1 text-[11px] text-muted-foreground text-right">{fmt(amounts[i])}</span>
              )}
              <button type="button" onClick={() => removeRow(i)}
                className="col-span-1 flex justify-center text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" size="sm" className="text-xs h-7" onClick={addRow}>
          <Plus className="h-3 w-3 mr-1" /> Installment Add Karo
        </Button>
        {value.length > 0 && (
          <span className={`text-xs font-medium ${overAllocated || underAllocated ? 'text-amber-600' : 'text-green-700'}`}>
            Plan: {fmt(allocated)} / {fmt(totalAmount)}
          </span>
        )}
      </div>

      {(overAllocated || underAllocated) && (
        <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          <AlertTriangle className="h-3.5 w-3.5" />
          {overAllocated ? 'Installments PO total se zyada ho gaye.' : 'Poora PO cover nahi hua — ek balance installment add karo.'}
        </div>
      )}
    </div>
  );
}
