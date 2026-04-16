// src/components/procurement/PaymentTermsModal.tsx
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { callClaude } from '@/lib/claudeProxy';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────
interface PaymentTermsResult {
  payment_terms_type: string;
  payment_terms_raw: string;
  payment_terms_json: {
    type: string;
    net_days?: number;
    advance_percent?: number;
    installments?: Array<{
      description: string;
      percent: number;
      trigger: string;
      days?: number;
    }>;
    notes?: string;
  };
  payment_due_date?: string;
  confidence: number;
  confidence_reason: string;
}

interface Props {
  open: boolean;
  poId: string;
  poNumber: string;
  supplierName: string;
  totalAmount: number;
  projectSite: string;
  linkedQuoteId?: string;
  onSuccess: () => void;
  onClose: () => void;
}

// ── Schema ─────────────────────────────────────────────────────────────────
const schema = z.object({
  payment_terms_type: z.string().min(1, 'Payment terms type is required'),
  payment_terms_raw: z.string().optional(),
  payment_due_date: z.string().optional(),
  payment_terms_notes: z.string().optional(),
  installments_json: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

// ── Component ──────────────────────────────────────────────────────────────
export function PaymentTermsModal({
  open, poId, poNumber, supplierName, totalAmount,
  projectSite, linkedQuoteId, onSuccess, onClose
}: Props) {
  const { user } = useAuth();
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<PaymentTermsResult | null>(null);
  const [aiAttempted, setAiAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      payment_terms_type: '',
      payment_terms_raw: '',
      payment_due_date: '',
      payment_terms_notes: '',
      installments_json: '',
    }
  });

  // Reset state when modal opens for a different PO
  useEffect(() => {
    if (open && !aiAttempted) {
      runAiExtraction();
    }
    if (!open) {
      setAiAttempted(false);
      setAiResult(null);
      form.reset();
    }
  }, [open]);

  async function runAiExtraction() {
    setAiLoading(true);
    setAiAttempted(true);
    try {
      let quoteContext = '';
      if (linkedQuoteId) {
        const { data: quoteItems } = await supabase
          .from('cps_quote_line_items')
          .select('*')
          .eq('quote_id', linkedQuoteId);
        if (quoteItems?.length) {
          quoteContext = JSON.stringify(quoteItems, null, 2);
        }
      }

      const { data: poItems } = await supabase
        .from('cps_po_line_items')
        .select('*')
        .eq('po_id', poId);

      const prompt = `You are a procurement payment terms extractor for an Indian construction company.

Analyse the following Purchase Order data and extract the payment terms.

PO Number: ${poNumber}
Supplier: ${supplierName}
Total Amount: ₹${totalAmount.toLocaleString('en-IN')}
Project Site: ${projectSite}

PO Line Items:
${JSON.stringify(poItems, null, 2)}

${quoteContext ? `Supplier Quote Data:\n${quoteContext}` : 'No quote data available.'}

Extract the payment terms and respond ONLY with a valid JSON object — no markdown, no explanation, no backticks:

{
  "payment_terms_type": "human-readable summary e.g. '30 days net' or '50% advance 50% on delivery'",
  "payment_terms_raw": "exact verbatim text from the document if found, else empty string",
  "payment_terms_json": {
    "type": "net_days | advance | lc | milestone | immediate | other",
    "net_days": 30,
    "advance_percent": null,
    "installments": [
      { "description": "On order placement", "percent": 50, "trigger": "on_order" },
      { "description": "On delivery", "percent": 50, "trigger": "on_delivery" }
    ],
    "notes": "any special conditions"
  },
  "payment_due_date": "YYYY-MM-DD or null",
  "confidence": 85,
  "confidence_reason": "Found explicit payment terms in quote line item notes field"
}

If you cannot find any payment terms, set confidence to 0 and leave payment_terms_type as empty string.`;

      const response = await callClaude({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = response?.content?.[0]?.text ?? '';
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed: PaymentTermsResult = JSON.parse(clean);
      setAiResult(parsed);

      if (parsed.confidence >= 70) {
        form.setValue('payment_terms_type', parsed.payment_terms_type);
        form.setValue('payment_terms_raw', parsed.payment_terms_raw ?? '');
        form.setValue('payment_due_date', parsed.payment_due_date ?? '');
        if (parsed.payment_terms_json?.installments?.length) {
          form.setValue('installments_json',
            JSON.stringify(parsed.payment_terms_json.installments, null, 2));
        }
      }
    } catch (err) {
      console.error('AI extraction failed:', err);
      setAiResult(null);
    } finally {
      setAiLoading(false);
    }
  }

  async function onSubmit(values: FormValues) {
    if (!user) return;
    setSubmitting(true);
    try {
      let termsJson = aiResult?.payment_terms_json ?? null;
      if (values.installments_json?.trim()) {
        try {
          termsJson = JSON.parse(values.installments_json);
        } catch {
          toast.error('Invalid installments JSON format');
          setSubmitting(false);
          return;
        }
      }

      const source = aiResult && aiResult.confidence >= 70
        ? (values.payment_terms_type !== aiResult.payment_terms_type ? 'ai_override' : 'ai_extracted')
        : 'manual';

      const { error: updateError } = await supabase
        .from('cps_purchase_orders')
        .update({
          status: 'sent',
          payment_terms_type: values.payment_terms_type,
          payment_terms_raw: values.payment_terms_raw || null,
          payment_terms_json: termsJson,
          payment_terms_source: source,
          payment_terms_confidence: aiResult?.confidence ?? 0,
          payment_due_date: values.payment_due_date || null,
          payment_terms_notes: values.payment_terms_notes || null,
        })
        .eq('id', poId);

      if (updateError) throw updateError;

      await supabase.from('cps_audit_log').insert({
        user_id: user.id,
        user_name: user.name,
        user_role: user.role,
        action_type: 'PO_PAYMENT_TERMS_SET',
        entity_type: 'purchase_order',
        entity_id: poId,
        entity_number: poNumber,
        description: `Payment terms set for ${poNumber}: "${values.payment_terms_type}" (source: ${source})`,
        after_value: {
          payment_terms_type: values.payment_terms_type,
          source,
          confidence: aiResult?.confidence ?? 0,
        },
        severity: 'info',
        logged_at: new Date().toISOString(),
      });

      await fireFinanceWebhook(poId, values, termsJson, source);

      toast.success('Payment terms saved and sent to Finance');
      onSuccess();
    } catch (err) {
      console.error(err);
      toast.error('Failed to save payment terms');
    } finally {
      setSubmitting(false);
    }
  }

  async function fireFinanceWebhook(
    poId: string,
    values: FormValues,
    termsJson: unknown,
    source: string
  ) {
    try {
      const { data: po } = await supabase
        .from('cps_purchase_orders')
        .select(`
          *,
          cps_po_line_items(*),
          cps_suppliers(name, phone, whatsapp, email, gstin),
          cps_purchase_requisitions(project_site, project_code)
        `)
        .eq('id', poId)
        .single();

      const { data: cfg } = await supabase
        .from('cps_config')
        .select('value')
        .eq('key', 'webhook_po_finance_dispatch')
        .maybeSingle();

      if (!cfg?.value || cfg.value === 'REPLACE_WITH_N8N_WF4_WEBHOOK_URL') {
        console.warn('WF4 webhook URL not configured in cps_config');
        return;
      }

      const payload = {
        event: 'po_finance_dispatch',
        cps_po_id: poId,
        cps_po_ref: po.po_number,
        project_name: po.cps_purchase_requisitions?.project_site
          || po.cps_purchase_requisitions?.project_code
          || po.ship_to_address,
        site: po.ship_to_address,
        supplier_name: po.cps_suppliers?.name,
        supplier_gstin: po.cps_suppliers?.gstin,
        supplier_phone: po.cps_suppliers?.whatsapp || po.cps_suppliers?.phone,
        total_amount: po.grand_total || po.total_value || 0,
        line_items: po.cps_po_line_items,
        payment_terms_type: values.payment_terms_type,
        payment_terms_raw: values.payment_terms_raw,
        payment_terms_json: termsJson,
        payment_terms_source: source,
        payment_due_date: values.payment_due_date || null,
        payment_terms_notes: values.payment_terms_notes || null,
        dispatched_at: new Date().toISOString(),
      };

      await fetch(cfg.value, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      await supabase
        .from('cps_purchase_orders')
        .update({
          finance_dispatch_sent_at: new Date().toISOString(),
          finance_dispatch_status: 'sent',
        })
        .eq('id', poId);
    } catch (err) {
      console.error('WF4 webhook failed:', err);
      await supabase
        .from('cps_purchase_orders')
        .update({ finance_dispatch_status: 'failed' })
        .eq('id', poId);
    }
  }

  const isAiConfident = aiResult && aiResult.confidence >= 70;
  const isAiFailed = aiAttempted && !aiLoading && !aiResult;
  const isAiLow = aiResult && aiResult.confidence < 70;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Payment Terms
            <Badge variant="outline" className="text-xs font-normal">
              {poNumber}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {aiLoading && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading PO and quote — extracting payment terms via AI...
          </div>
        )}

        {isAiConfident && !aiLoading && (
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800 text-sm">
              AI extracted payment terms with <strong>{aiResult.confidence}% confidence</strong>.
              {' '}{aiResult.confidence_reason}. Review and confirm below.
            </AlertDescription>
          </Alert>
        )}

        {(isAiFailed || isAiLow) && !aiLoading && (
          <Alert className="border-amber-200 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800 text-sm">
              {isAiFailed
                ? 'AI could not extract payment terms from this PO. Please enter them manually below.'
                : `AI confidence is low (${aiResult?.confidence}%): ${aiResult?.confidence_reason}. Please review and correct.`
              }
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-2">

            <FormField
              control={form.control}
              name="payment_terms_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Payment Terms
                    {isAiConfident && (
                      <Badge className="ml-2 text-xs bg-green-100 text-green-700 border-green-200">
                        <Sparkles className="h-3 w-3 mr-1" />AI extracted
                      </Badge>
                    )}
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. 30 days net, 50% advance 50% on delivery, LC 90 days..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-muted-foreground mt-1">
                    Common terms: <span className="font-mono">30 days net</span> ·
                    {' '}<span className="font-mono">advance 100%</span> ·
                    {' '}<span className="font-mono">50% advance + 50% on delivery</span> ·
                    {' '}<span className="font-mono">LC 90 days</span> ·
                    {' '}<span className="font-mono">immediate</span>
                  </p>
                </FormItem>
              )}
            />

            {aiResult?.payment_terms_raw && (
              <FormField
                control={form.control}
                name="payment_terms_raw"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-muted-foreground text-sm">
                      Verbatim text from document (read-only)
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        className="text-sm bg-muted"
                        readOnly
                        {...field}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="payment_due_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Due Date <span className="text-muted-foreground">(optional)</span></FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">
                Installment breakdown (optional JSON)
              </summary>
              <FormField
                control={form.control}
                name="installments_json"
                render={({ field }) => (
                  <FormItem className="mt-2">
                    <FormControl>
                      <Textarea
                        rows={5}
                        className="font-mono text-xs"
                        placeholder={`[\n  { "description": "On order", "percent": 50, "trigger": "on_order" },\n  { "description": "On delivery", "percent": 50, "trigger": "on_delivery" }\n]`}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </details>

            <FormField
              control={form.control}
              name="payment_terms_notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes for Finance Team <span className="text-muted-foreground">(optional)</span></FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Any special conditions, bank details, or instructions for Finance..."
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground"
                onClick={runAiExtraction}
                disabled={aiLoading}
              >
                {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Re-run AI
              </Button>
              <Button type="submit" disabled={submitting || aiLoading}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Confirm & Send to Finance
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
