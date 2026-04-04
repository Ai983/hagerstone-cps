# CURSOR TASK: Vendor Quote Portal — Typeform-Style Redesign + AI Pre-Fill

## Context
Read `CPS_PRD_FOR_CURSOR.md` first.
File: `src/pages/vendor/VendorUploadQuote.tsx`

The vendor portal at `/vendor/upload-quote?token=xxx` currently shows everything on one page.
Redesign it as a typeform-style multi-step flow — ONE question per screen, full-page, smooth slide transitions.
Keep all existing logic (token validation, Supabase inserts, file upload) exactly the same.

---

## STEP STRUCTURE (7 steps)

```
Step 1 → Upload or Skip (file upload + AI extract)
Step 2 → Payment Terms
Step 3 → Delivery Timeline
Step 4 → Freight / Delivery Charges
Step 5 → Item Rates (one item per screen if multiple)
Step 6 → Quote Reference Number (optional)
Step 7 → Review & Submit
```

---

## DESIGN SYSTEM

Full-page layout per step. Hagerstone brown/gold theme:
- Background: `#FAF7F4` (warm off-white)
- Progress bar: thin brown line at very top, fills left to right
- Primary: `hsl(20, 50%, 35%)` (Hagerstone brown)
- Gold: `hsl(45, 85%, 65%)`
- Large centered question (text-2xl font-semibold), single input below
- Back / Continue buttons at bottom right
- Enter key advances to next step

Fixed header (all steps):
```
[H] Hagerstone International          RFQ-2026-0030
    Quote Submission Portal            Aniket Traders · Deadline: 7 Apr 2026
```

Step counter: `2 of 7` shown subtly below progress bar.

---

## STEP 1 — Upload Quote File

```
Do you have a quote document to upload?

Items we need rates for:
• Gypsum Board 24mm — 5 sqft

[  📎 Drop file here or tap to browse  ]
   PDF, Excel, Word, Image — max 25MB

        [ Skip, I'll fill manually → ]
```

On file upload:
1. Upload to Supabase Storage `cps-quotes` bucket: `rfq/{rfq_number}/{uuid}-{filename}`
2. Show spinner: "⬆️ Uploading..."
3. After upload → call Claude API to extract (see AI section below)
4. Show: "🤖 Reading your quote..."
5. Show: "✅ Details pre-filled from your document"
6. Auto-advance to Step 2

On skip → advance to Step 2 with all fields empty.

---

## STEP 2 — Payment Terms

```
What are your payment terms?

[  30 days credit                              ]
   ↑ pre-filled by AI if extracted

Quick picks: [30 days credit] [50% advance] [100% advance] [Against delivery]

← Back          Continue →
```

---

## STEP 3 — Delivery Timeline

```
How many days to deliver after receiving PO?

[  7  ] working days
   ↑ pre-filled by AI

[3 days] [7 days] [14 days] [21 days] [30 days]

← Back          Continue →
```

---

## STEP 4 — Freight Charges

```
What are your freight / delivery charges?

○ Included in my rates (free delivery)
○ Extra — will be added to invoice
○ To be confirmed based on quantity

Notes (optional): [                    ]

← Back          Continue →
```

---

## STEP 5 — Item Rates (repeat per item)

For each RFQ line item show a full screen. If 3 items → 3 sub-steps shown as "Item 1 of 3":

```
Your rate for:
Gypsum Board 24mm
Needed: 5 sqft · For 1st floor

₹ [  450  ] per sqft    ← pre-filled by AI
   (excluding GST)

GST %:  [  18  ] %      ← pre-filled by AI

Brand (optional): [  Saint-Gobain  ]

Total: ₹2,655.00        ← live calculated

← Back          Continue →
```

---

## STEP 6 — Quote Reference

```
Your internal quote reference number?
(optional)

[  QT-2025-074  ]   ← pre-filled by AI

← Back          Skip →    Continue →
```

---

## STEP 7 — Review & Submit

Show a clean summary card:

```
Review & Confirm

RFQ-2026-0030 · Aniket Traders

┌────────────────────────────────────────┐
│ Gypsum Board 24mm                       │
│ Rate: ₹450/sqft + 18% GST = ₹531/sqft  │
│ Total for 5 sqft: ₹2,655               │
├────────────────────────────────────────┤
│ Payment: 30 days credit                 │
│ Delivery: 7 working days                │
│ Freight: Extra — in invoice             │
│ File: gypsum_quote.pdf ✅              │
└────────────────────────────────────────┘

By submitting you confirm this is your best price.

← Edit             [ Submit Quote → ]
```

Submit button triggers the EXISTING save logic — no changes to DB inserts.

---

## AI PRE-FILL (called after file upload in Step 1)

```typescript
const extractQuoteWithAI = async (file: File, rfqItems: any[]) => {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const mediaType = file.type as any;
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
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          contentBlock,
          {
            type: 'text',
            text: `Extract quotation details from this document.
Items needed: ${rfqItems.map(i => i.description).join(', ')}

Return ONLY valid JSON (no markdown):
{
  "payment_terms": "string or empty",
  "delivery_days": number or null,
  "freight_terms": "included" or "extra" or "negotiable" or "",
  "freight_notes": "string or empty",
  "quote_reference": "string or empty",
  "line_items": [
    {
      "description": "item description",
      "rate": number,
      "unit": "string",
      "gst_percent": number or null,
      "brand": "string or empty"
    }
  ]
}`
          }
        ]
      }]
    })
  });

  const data = await response.json();
  const raw = data.content?.[0]?.text || '{}';
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
};
```

After extraction, set state for all steps:
```typescript
if (extracted.payment_terms) setPaymentTerms(extracted.payment_terms);
if (extracted.delivery_days) setDeliveryDays(String(extracted.delivery_days));
if (extracted.freight_terms) setFreightOption(extracted.freight_terms);
if (extracted.freight_notes) setFreightNotes(extracted.freight_notes);
if (extracted.quote_reference) setQuoteRef(extracted.quote_reference);

// Match line items to RFQ items
rfqItems.forEach((rfqItem, idx) => {
  const match = extracted.line_items?.find((li: any) =>
    rfqItem.description.toLowerCase().includes(
      li.description.toLowerCase().substring(0, 8)
    ) || li.description.toLowerCase().includes(
      rfqItem.description.toLowerCase().substring(0, 8)
    )
  );
  if (match) {
    updateLineItem(idx, 'rate', match.rate);
    updateLineItem(idx, 'gst_percent', match.gst_percent ?? 18);
    updateLineItem(idx, 'brand', match.brand || '');
  }
});
```

---

## ANIMATIONS

```tsx
// Slide transition between steps
const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? '-100%' : '100%', opacity: 0 }),
};
```

If framer-motion is not installed, use simple CSS:
```css
.step-enter { animation: slideIn 250ms ease forwards; }
@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
```

---

## SUCCESS SCREEN

```
✅ Quote Submitted!

Reference: QT-2026-XXXX

We'll contact you if your quote is shortlisted.

procurement@hagerstone.com | +91 8448992353
Hagerstone International (P) Ltd
```

---

## CRITICAL — Do NOT change:
- Token validation and lookup from URL
- `cps_quotes` insert (same all fields)
- `cps_quote_line_items` insert (same all fields)
- `cps_rfq_suppliers` response_status update
- Error screens for invalid/expired/used tokens

## FILES TO MODIFY
- `src/pages/vendor/VendorUploadQuote.tsx` — full redesign (keep all DB logic)
