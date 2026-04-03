import React from "react";
import type { ParsedInvoice } from "@/services/invoice-parser";
import type { LineMaterialChoice } from "@/services/invoice-uploader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Check, Pencil, SkipForward } from "lucide-react";

export type ReviewDecision = "pending" | "approved" | "skipped";

export interface MaterialOption {
  id: string;
  canonical_name: string;
}

function confidenceBadge(confidence: number) {
  if (confidence >= 80)
    return <Badge className="border-0 bg-emerald-600/15 text-emerald-800 dark:text-emerald-300">High ({confidence})</Badge>;
  if (confidence >= 50)
    return <Badge className="border-0 bg-amber-500/15 text-amber-900 dark:text-amber-200">Medium ({confidence})</Badge>;
  return <Badge className="border-0 bg-destructive/15 text-destructive">Low ({confidence})</Badge>;
}

function lineChoiceToSelectValue(c: LineMaterialChoice): string {
  if (c.kind === "auto") return "__auto__";
  if (c.kind === "new") return "__new__";
  return c.materialId;
}

function selectValueToLineChoice(v: string): LineMaterialChoice {
  if (v === "__auto__") return { kind: "auto" };
  if (v === "__new__") return { kind: "new" };
  return { kind: "existing", materialId: v };
}

interface ParsedInvoiceReviewProps {
  accordionValue: string;
  fileName: string;
  parsed: ParsedInvoice;
  onParsedChange: (next: ParsedInvoice) => void;
  existingVendorMatch: boolean;
  materials: MaterialOption[];
  lineChoices: LineMaterialChoice[];
  onLineChoicesChange: (next: LineMaterialChoice[]) => void;
  decision: ReviewDecision;
  editing: boolean;
  onToggleEdit: () => void;
  onApprove: () => void;
  onSkip: () => void;
}

export function ParsedInvoiceReview({
  accordionValue,
  fileName,
  parsed,
  onParsedChange,
  existingVendorMatch,
  materials,
  lineChoices,
  onLineChoicesChange,
  decision,
  editing,
  onToggleEdit,
  onApprove,
  onSkip,
}: ParsedInvoiceReviewProps) {
  const setVendor = (patch: Partial<ParsedInvoice["vendor"]>) => {
    onParsedChange({ ...parsed, vendor: { ...parsed.vendor, ...patch } });
  };
  const setInvoice = (patch: Partial<ParsedInvoice["invoice"]>) => {
    onParsedChange({ ...parsed, invoice: { ...parsed.invoice, ...patch } });
  };
  const setLine = (index: number, patch: Partial<ParsedInvoice["line_items"][0]>) => {
    const line_items = parsed.line_items.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onParsedChange({ ...parsed, line_items });
  };

  const updateLineChoice = (index: number, value: string) => {
    const next = [...lineChoices];
    next[index] = selectValueToLineChoice(value);
    onLineChoicesChange(next);
  };

  const newVendor = !parsed.vendor.gstin || !existingVendorMatch;

  return (
    <AccordionItem value={accordionValue} className="border rounded-lg px-4 bg-card">
      <AccordionTrigger className="hover:no-underline py-4">
        <div className="flex flex-1 flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-left pr-2">
          <div>
            <p className="font-medium text-foreground">{fileName}</p>
            <p className="text-sm text-muted-foreground">
              {parsed.invoice.invoice_number} · {parsed.vendor.name}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {confidenceBadge(parsed.confidence)}
            {decision === "approved" && (
              <Badge className="border-0 bg-primary/15 text-primary">
                <Check className="h-3 w-3 mr-1" /> Approved
              </Badge>
            )}
            {decision === "skipped" && (
              <Badge variant="secondary">Skipped</Badge>
            )}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-6 space-y-6">
        {parsed.warnings?.length > 0 && (
          <Alert className="border-amber-500/40 bg-amber-500/10">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Warnings</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 text-sm mt-1 space-y-0.5">
                {parsed.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          {newVendor ? (
            <Badge className="border-0 bg-amber-500/15 text-amber-900 dark:text-amber-200">
              New vendor — will be created
            </Badge>
          ) : (
            <Badge className="border-0 bg-emerald-600/15 text-emerald-800 dark:text-emerald-300">
              Existing vendor (matched by GSTIN)
            </Badge>
          )}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Vendor</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1 md:col-span-2">
              <Label>Name</Label>
              <Input
                disabled={!editing}
                value={parsed.vendor.name}
                onChange={(e) => setVendor({ name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>GSTIN</Label>
              <Input
                disabled={!editing}
                value={parsed.vendor.gstin ?? ""}
                onChange={(e) => setVendor({ gstin: e.target.value || null })}
              />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input
                disabled={!editing}
                value={parsed.vendor.phone ?? ""}
                onChange={(e) => setVendor({ phone: e.target.value || null })}
              />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                disabled={!editing}
                value={parsed.vendor.email ?? ""}
                onChange={(e) => setVendor({ email: e.target.value || null })}
              />
            </div>
            <div className="space-y-1">
              <Label>City</Label>
              <Input
                disabled={!editing}
                value={parsed.vendor.city ?? ""}
                onChange={(e) => setVendor({ city: e.target.value || null })}
              />
            </div>
            <div className="space-y-1">
              <Label>State</Label>
              <Input
                disabled={!editing}
                value={parsed.vendor.state ?? ""}
                onChange={(e) => setVendor({ state: e.target.value || null })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Invoice</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Invoice number</Label>
              <Input
                disabled={!editing}
                value={parsed.invoice.invoice_number}
                onChange={(e) => setInvoice({ invoice_number: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Date (YYYY-MM-DD)</Label>
              <Input
                disabled={!editing}
                value={parsed.invoice.invoice_date ?? ""}
                onChange={(e) => setInvoice({ invoice_date: e.target.value || null })}
              />
            </div>
            <div className="space-y-1">
              <Label>Total amount</Label>
              <Input
                disabled={!editing}
                type="number"
                value={parsed.invoice.total_amount ?? ""}
                onChange={(e) =>
                  setInvoice({
                    total_amount: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Document type</Label>
              <Select
                disabled={!editing}
                value={parsed.invoice.document_type}
                onValueChange={(v) =>
                  setInvoice({ document_type: v as ParsedInvoice["invoice"]["document_type"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tax_invoice">tax_invoice</SelectItem>
                  <SelectItem value="credit_note">credit_note</SelectItem>
                  <SelectItem value="proforma">proforma</SelectItem>
                  <SelectItem value="delivery_challan">delivery_challan</SelectItem>
                  <SelectItem value="quotation">quotation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Project name</Label>
              <Input
                disabled={!editing}
                value={parsed.invoice.project_name ?? ""}
                onChange={(e) => setInvoice({ project_name: e.target.value || null })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Line items</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-2 sm:p-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-20">Qty</TableHead>
                  <TableHead className="w-24">Unit</TableHead>
                  <TableHead className="w-24">Rate</TableHead>
                  <TableHead className="w-20">Tax %</TableHead>
                  <TableHead className="w-28">HSN</TableHead>
                  <TableHead className="w-24">Total</TableHead>
                  <TableHead className="w-32">Type</TableHead>
                  <TableHead className="min-w-[200px]">Material</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsed.line_items.map((row, index) => {
                  const choice = lineChoices[index] ?? { kind: "auto" as const };
                  const matLabel =
                    choice.kind === "existing"
                      ? materials.find((m) => m.id === choice.materialId)?.canonical_name ?? choice.materialId
                      : choice.kind === "new"
                        ? "New — will be created"
                        : "Auto match";
                  return (
                    <TableRow key={index}>
                      <TableCell>
                        <Input
                          disabled={!editing}
                          className="min-w-[140px]"
                          value={row.description}
                          onChange={(e) => setLine(index, { description: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          disabled={!editing}
                          type="number"
                          value={row.quantity}
                          onChange={(e) => setLine(index, { quantity: Number(e.target.value) })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          disabled={!editing}
                          value={row.unit}
                          onChange={(e) => setLine(index, { unit: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          disabled={!editing}
                          type="number"
                          value={row.rate}
                          onChange={(e) => setLine(index, { rate: Number(e.target.value) })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          disabled={!editing}
                          type="number"
                          value={row.tax_percent ?? ""}
                          onChange={(e) =>
                            setLine(index, {
                              tax_percent: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          disabled={!editing}
                          value={row.hsn_sac ?? ""}
                          onChange={(e) => setLine(index, { hsn_sac: e.target.value || null })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          disabled={!editing}
                          type="number"
                          value={row.line_total ?? ""}
                          onChange={(e) =>
                            setLine(index, {
                              line_total: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          disabled={!editing}
                          value={row.item_type}
                          onValueChange={(v) =>
                            setLine(index, { item_type: v as ParsedInvoice["line_items"][0]["item_type"] })
                          }
                        >
                          <SelectTrigger className="w-[7rem]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="material">material</SelectItem>
                            <SelectItem value="labour">labour</SelectItem>
                            <SelectItem value="freight">freight</SelectItem>
                            <SelectItem value="tax">tax</SelectItem>
                            <SelectItem value="other">other</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1 min-w-[180px]">
                          <Select
                            value={lineChoiceToSelectValue(choice)}
                            onValueChange={(v) => updateLineChoice(index, v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Match" />
                            </SelectTrigger>
                            <SelectContent className="max-h-64">
                              <SelectItem value="__auto__">Auto match</SelectItem>
                              <SelectItem value="__new__">Create new material</SelectItem>
                              {materials.map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.canonical_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground truncate" title={matLabel}>
                            {matLabel}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onToggleEdit}>
            <Pencil className="h-4 w-4 mr-2" />
            {editing ? "Lock" : "Edit"}
          </Button>
          <Button type="button" variant="secondary" onClick={onSkip} disabled={decision === "skipped"}>
            <SkipForward className="h-4 w-4 mr-2" />
            Skip
          </Button>
          <Button type="button" onClick={onApprove} disabled={decision === "approved"}>
            <Check className="h-4 w-4 mr-2" />
            Approve for import
          </Button>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
