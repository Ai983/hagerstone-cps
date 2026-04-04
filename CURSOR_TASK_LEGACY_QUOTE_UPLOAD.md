# CURSOR TASK: Legacy Quote Upload + New Vendor Quick-Add (Quotes Page)

## Context
Read `CPS_PRD_FOR_CURSOR.md` first.

Procurement staff are calling vendors and collecting quotes over phone/paper. They need to enter these into the system against the relevant RFQ. Two scenarios:
- Vendor is already in DB → select them, upload their quote
- Vendor is NOT in DB → quick-add with minimal info, upload quote

New DB columns already added:
- `cps_quotes`: `is_legacy`, `legacy_file_url`, `legacy_vendor_name`, `legacy_vendor_phone`, `legacy_vendor_gstin`, `ai_extracted_vendor_details`, `channel` now accepts `'legacy'`
- `cps_rfq_suppliers`: `added_manually`, `added_by`, `added_at`
- `cps_suppliers`: `added_via_rfq_id`, `profile_complete`

---

## WHERE TO ADD THIS

On the **Quotes page** (`/quotes`), add a button: **"+ Upload Legacy Quote"**

This opens `LegacyQuoteUploadModal`.

Also accessible from inside an RFQ detail view — a button "Record Manual Quote" per RFQ.

---

## `LegacyQuoteUploadModal` — 3-step flow

### Step 1 — Select RFQ
Dropdown to pick which RFQ this quote belongs to:
```
Which RFQ is this quote for? *
[RFQ-2026-0030 — Furniture items for iStreet ▼]
```
Load from `cps_rfqs` where `status IN ('draft','sent','reminder_1','reminder_2','reminder_3')`.
Show: `rfq_number — title — deadline`

After selecting RFQ → show the items in that RFQ as reference (read-only):
```
Items in this RFQ:
• Office Chair × 10 nos
• Workstation Table × 5 nos
```

### Step 2 — Select or Add Vendor

**Two tabs:**

#### Tab A: "Existing Vendor"
Search box → searches `cps_suppliers` by name
Shows matched suppliers with category badges.

On select → proceed to Step 3.

#### Tab B: "New Vendor (Not in System)"
Show quick-add form:
```
Vendor Name *     [____________________]
Phone *           [+91 ________________]  ← WhatsApp number for quote requests
Email             [____________________]  ← optional
GSTIN             [____________________]  ← optional
```

On "Add & Continue →":
```typescript
const { data: newSupplier } = await supabase
  .from('cps_suppliers')
  .insert({
    name: form.vendorName,
    phone: form.phone,
    whatsapp: form.phone, // same as phone for now
    email: form.email || null,
    gstin: form.gstin || null,
    added_via: 'legacy_quote',
    added_via_rfq_id: selectedRfqId,
    profile_complete: false, // minimal info — needs enrichment
    status: 'active',
    categories: ['General'], // default until enriched
    verified: false,
  })
  .select().single();

// Also add them to cps_rfq_suppliers for this RFQ
await supabase.from('cps_rfq_suppliers').insert({
  rfq_id: selectedRfqId,
  supplier_id: newSupplier.id,
  added_manually: true,
  added_by: currentUser.id,
  response_status: 'responded', // they already gave a quote
});
```

Show badge: `🆕 New Vendor Added` in amber.

---

### Step 3 — Upload Quote & AI Extract

**File upload zone** (PDF or IMAGE accepted here — because vendors send photos over WhatsApp):
```
📎 Upload Quote Document
PDF, JPG, PNG accepted · Max 10MB
(Vendor's quotation paper, WhatsApp image, email screenshot)
```

Upload to Supabase Storage bucket `cps-quotes`:
Path: `legacy-quotes/{rfq_number}/{vendor_name}-{uuid}.{ext}`

After upload → **call Claude API to extract quote details**:

```typescript
const extractQuoteDetails = async (file: File, rfqItems: string[]) => {
  const base64 = await fileToBase64(file);
  const mediaType = file.type; // application/pdf, image/jpeg, image/png

  const contentBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          contentBlock,
          {
            type: 'text',
            text: `Extract all quotation details from this vendor quote document.

RFQ items we need quotes for: ${rfqItems.join(', ')}

Return ONLY a valid JSON object (no markdown):
{
  "vendor_name": "string",
  "vendor_phone": "string",
  "vendor_gstin": "string or empty",
  "vendor_email": "string or empty",
  "vendor_address": "string or empty",
  "quote_date": "YYYY-MM-DD or empty",
  "validity_days": number or null,
  "payment_terms": "string or empty",
  "delivery_days": number or null,
  "freight_terms": "string or empty — e.g. Extra, Included, Free Delivery",
  "gst_percent": number or null,
  "line_items": [
    {
      "description": "item description as written in quote",
      "quantity": number,
      "unit": "string",
      "rate": number,
      "gst_percent": number or null,
      "total": number,
      "brand": "string or empty",
      "notes": "string or empty"
    }
  ],
  "total_value": number,
  "total_with_gst": number,
  "special_notes": "string or empty"
}

Rules:
- All amounts must be plain numbers without currency symbols or commas
- If a field is not found, use empty string or null
- line_items must be an array even if only one item`,
          },
        ],
      }],
    }),
  });

  const data = await response.json();
  const raw = data.content?.[0]?.text || '{}';
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
};
```

---

### Step 3 UI — Review & Edit Extracted Details

After AI extraction, show an **editable review form**:

```
✅ Quote details extracted — please verify

Vendor Name      [A.S ENTERPRISES         ]  ← pre-filled, editable
Phone            [9953901423              ]
GSTIN            [07AKHPA6357R1ZM         ]
Quote Date       [02/04/2026              ]
Payment Terms    [Advance                 ]
Delivery         [4 days                  ]
Freight          [Extra, in bill          ]

── Line Items ──────────────────────────────
Item 1  [G.I. Sheet 3mm Drain Gutter (Patnala)]  1240 kg  @ ₹115  = ₹1,42,600  GST 18%
Item 2  [Powder Coating                        ]  1240 kg  @ ₹10   = ₹12,400   GST 18%

[+ Add Item]

Total excl GST:  ₹1,55,000
GST:             ₹27,900
Grand Total:     ₹1,82,900

Notes: [________________________________]
```

Each field is editable. Line items can be added/removed.

---

### On "Submit Quote →":

```typescript
// 1. Create cps_quotes record
const { data: quote } = await supabase.from('cps_quotes').insert({
  rfq_id: selectedRfqId,
  supplier_id: selectedSupplier.id,
  channel: 'legacy',
  is_legacy: true,
  legacy_file_url: fileUrl,
  raw_file_path: storagePath,
  raw_file_type: file.type,
  parse_status: 'needs_review', // procurement must confirm
  submitted_by_human: true,
  payment_terms: extracted.payment_terms,
  delivery_terms: `${extracted.delivery_days} days`,
  freight_terms: extracted.freight_terms,
  total_quoted_value: extracted.total_value,
  total_landed_value: extracted.total_with_gst,
  ai_parsed_data: extracted,
  ai_extracted_vendor_details: extracted,
  notes: form.notes,
  legacy_vendor_name: selectedSupplier.name,
}).select().single();

// 2. Insert line items
const lineItems = extractedLineItems.map((item, i) => ({
  quote_id: quote.id,
  original_description: item.description,
  quantity: item.quantity,
  unit: item.unit,
  rate: item.rate,
  gst_percent: item.gst_percent,
  total_landed_rate: item.rate * (1 + (item.gst_percent || 0) / 100),
  brand: item.brand,
  ai_suggested: true,
  confidence_score: 85,
}));
await supabase.from('cps_quote_line_items').insert(lineItems);

// 3. Update rfq_suppliers response status
await supabase.from('cps_rfq_suppliers')
  .update({ response_status: 'responded' })
  .eq('rfq_id', selectedRfqId)
  .eq('supplier_id', selectedSupplier.id);

// 4. Audit log
await supabase.from('cps_audit_log').insert({
  action_type: 'LEGACY_QUOTE_UPLOADED',
  entity_type: 'quote',
  entity_id: quote.id,
  entity_number: quote.blind_quote_ref,
  description: `Legacy quote uploaded for ${selectedSupplier.name} on RFQ ${selectedRfq.rfq_number}. Total: ₹${extracted.total_with_gst?.toLocaleString('en-IN')}. Submitted by ${currentUser.name}.`,
  severity: 'info',
});
```

Show toast: `"Quote recorded for [Vendor Name] — marked as Legacy Quote. Procurement review required."`

---

## QUOTES LIST — Visual changes

In the Quotes list table, add:

- **`LEGACY` badge** (amber/orange) on any quote where `is_legacy = true`
- **`NEW VENDOR` badge** (blue) on quotes from suppliers where `profile_complete = false`
- `parse_status = 'needs_review'` → show "⚠️ Review Required" chip in orange

---

## FILES TO CREATE / MODIFY
- CREATE: `src/components/quotes/LegacyQuoteUploadModal.tsx`
- MODIFY: `src/pages/Quotes.tsx` — add "Upload Legacy Quote" button + LEGACY/NEW VENDOR badges
