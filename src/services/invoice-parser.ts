export interface ParsedInvoice {
  vendor: {
    name: string;
    gstin: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  };
  invoice: {
    invoice_number: string;
    invoice_date: string | null;
    total_amount: number | null;
    document_type: "tax_invoice" | "credit_note" | "proforma" | "delivery_challan" | "quotation";
    project_name: string | null;
  };
  line_items: Array<{
    description: string;
    quantity: number;
    unit: string;
    rate: number;
    tax_percent: number | null;
    taxable_value: number | null;
    hsn_sac: string | null;
    line_total: number | null;
    item_type: "material" | "labour" | "freight" | "tax" | "other";
  }>;
  confidence: number;
  warnings: string[];
}

const SYSTEM_PROMPT = `You are an expert Indian invoice/bill parser for a construction and interiors company (Hagerstone International).

Extract ALL data from the invoice and return ONLY valid JSON — no markdown, no backticks, no explanation.

Rules:
- GSTIN format: 2-digit state code + 10 chars PAN + 1 check digit + Z + 1 digit (15 chars total). If you see something that looks like a GSTIN but doesn't match, still include it but add a warning.
- Dates must be YYYY-MM-DD format. Indian invoices often use DD/MM/YYYY or DD-MM-YYYY — convert them.
- Amounts should be numbers without commas or currency symbols.
- For each line item, classify item_type as: "material" (physical goods), "labour" (services/work), "freight" (transport/shipping), "tax" (additional tax entries), "other" (discounts, adjustments, etc.)
- tax_percent: Extract the GST rate (e.g., 18, 12, 5, 28). If CGST+SGST shown separately (e.g., 9%+9%), combine to total (18%).
- taxable_value: The value before tax for that line item.
- line_total: The total for that line item including tax. If not shown, compute as taxable_value * (1 + tax_percent/100).
- total_amount: The grand total of the invoice (including all taxes).
- If vendor state can be determined from GSTIN (first 2 digits = state code), include it.
- document_type: Determine from the document header — "tax_invoice", "credit_note", "proforma", "delivery_challan", or "quotation".
- confidence: 0-100 rating of how confident you are in the overall extraction.
- warnings: Array of any issues found (e.g., "Blurry image, rates may be inaccurate", "GSTIN format looks incorrect", "Could not determine invoice date").

Indian state codes for GSTIN: 01=JK, 02=HP, 03=PB, 04=CH, 05=UK, 06=HR, 07=DL, 08=RJ, 09=UP, 10=BR, 11=SK, 12=AR, 13=NL, 14=MN, 15=MZ, 16=TR, 17=ML, 18=AS, 19=WB, 20=JH, 21=OD, 22=CG, 23=MP, 24=GJ, 25=DD, 26=DNH, 27=MH, 29=KA, 30=GA, 32=KL, 33=TN, 34=PY, 35=AN, 36=TS, 37=AP, 38=LD.

Return this exact JSON structure:
{
  "vendor": {
    "name": "string",
    "gstin": "string or null",
    "phone": "string or null",
    "email": "string or null",
    "address": "string or null",
    "city": "string or null",
    "state": "string or null",
    "pincode": "string or null"
  },
  "invoice": {
    "invoice_number": "string",
    "invoice_date": "YYYY-MM-DD or null",
    "total_amount": number_or_null,
    "document_type": "tax_invoice|credit_note|proforma|delivery_challan|quotation",
    "project_name": "string or null"
  },
  "line_items": [
    {
      "description": "string",
      "quantity": number,
      "unit": "string",
      "rate": number,
      "tax_percent": number_or_null,
      "taxable_value": number_or_null,
      "hsn_sac": "string or null",
      "line_total": number_or_null,
      "item_type": "material|labour|freight|tax|other"
    }
  ],
  "confidence": number,
  "warnings": ["string"]
}`;

export async function parseInvoiceWithClaude(
  base64Data: string,
  mimeType: string,
  fileName: string,
): Promise<ParsedInvoice> {

  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");

  const content: Array<Record<string, unknown>> = [];

  if (isPdf) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: base64Data,
      },
    });
  } else if (isImage) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mimeType,
        data: base64Data,
      },
    });
  } else {
    throw new Error(`Unsupported mime type: ${mimeType}`);
  }

  content.push({
    type: "text",
    text: `Parse this Indian invoice/bill. Filename: "${fileName}". Extract all vendor details, invoice details, and line items. Return ONLY the JSON object, nothing else.`,
  });

  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error: fnError } = await supabase.functions.invoke("claude-proxy", {
    body: {
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    },
  });
  if (fnError) throw new Error("Claude proxy error: " + fnError.message);

  const text =
    ((data?.content ?? []) as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("") ?? "";

  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    return JSON.parse(cleaned) as ParsedInvoice;
  } catch {
    throw new Error(`Failed to parse Claude response as JSON: ${cleaned.slice(0, 200)}`);
  }
}
