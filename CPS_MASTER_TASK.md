# CPS MASTER TASK — Complete Production Build
# PRIORITY: SHIP TONIGHT — Zero snags, fully working
# Date: 31 March 2026
# Tool: Claude Code (Opus 4.6) in VS Code terminal

---

## READ FIRST — MANDATORY
1. Read CLAUDE.md for full project context
2. Read CPS_FOUNDER_ADDITIONS.md for business rules
3. Read every file in src/pages/ before making changes
4. This file has 7 sections — implement ALL in order
5. After EACH section, run `npx tsc --noEmit` and fix errors
6. After ALL sections, run `npx vite build` — MUST succeed

---

## CURRENT DB STATE (live — do NOT recreate tables)
- 19 PRs, 19 RFQs, 114 quotes (100 pending, 13 approved)
- 23 quote line items, 4 comparison sheets, 5 POs
- 62 suppliers (57 real + 5 test), 153 items, 198 benchmarks
- 7 users, 5 projects, 27 config entries
- Storage bucket: cps-quotes (public, 10MB, PDF/XLSX/JPG/PNG/WEBP/DOC)
- Deployed: https://hagerstone-cps.vercel.app
- Webhook RFQ: https://primary-production-72e3f.up.railway.app/webhook/build-1-rfq-dispatch
- Webhook PO: (empty in cps_config — n8n team will configure)
- New tables: cps_projects (5 rows), cps_vendor_feedback, cps_item_rate_history

## USERS IN DATABASE (7 users)
| Name | Email | Role | Department |
|------|-------|------|------------|
| Dhruv Agarwal | world@hagerstone.com | management | Whole Company |
| Bhaskar Tyagi | projects@hagerstone.com | management | Operations |
| Ritu Sharma | ea@hagerstone.com | management | Management |
| Avisha | procurement@hagerstone.com | procurement_head | Procurement |
| Amit Kr. Mishra | amitmishra@hagerstone.com | site_receiver | Site / Projects |
| Bipin Kumar Jha | bipinjha@hagerstone.com | finance | Accounts |
| Aniket Awasthi | ai@hagerstone.com | auditor | Management |

## ⚠ CRITICAL: ROLE-BASED ACCESS CONTROL

For production, simplify to TWO effective roles:

### ADMIN (management, procurement_head, procurement_executive, auditor, finance)
- Sees EVERYTHING: Dashboard, PRs, RFQs, Quotes, Comparison, POs, Delivery, Suppliers, Items, Audit
- Can create/approve/manage all entities

### EMPLOYEE (requestor, site_receiver)
- Can ONLY see:
  - `/requisitions` — raise new PRs + see their own PRs
  - `/delivery` — see delivery status of their PRs
  - Submit GRN after material arrives
- CANNOT see: RFQs, Quotes, Comparison Sheet, PO details, Supplier Master, Item Master, Audit Log, pricing info
- Their Dashboard shows ONLY: "My PRs" count, "Pending Deliveries" count — NO pricing, NO supplier info

### Implementation in Layout/Sidebar/BottomNav:
```typescript
// In Sidebar.tsx and BottomNav.tsx:
const isEmployee = user.role === 'requestor' || user.role === 'site_receiver';

// Employee nav items — ONLY these 3:
const employeeNav = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
  { label: "Purchase Requests", icon: FileText, path: "/requisitions" },
  { label: "Delivery Tracker", icon: Truck, path: "/delivery" },
];

// Admin nav items — ALL pages
const adminNav = [/* all existing nav items */];

const navItems = isEmployee ? employeeNav : adminNav;
```

### Implementation in ProtectedRoute:
```typescript
// Block employees from admin-only routes
const adminOnlyRoutes = ['/rfqs', '/quotes', '/comparison', '/purchase-orders', '/suppliers', '/items', '/audit'];
if (isEmployee && adminOnlyRoutes.some(r => location.pathname.startsWith(r))) {
  return <Navigate to="/dashboard" />;
}
```

### Employee Dashboard (simplified):
- Show ONLY: "My Purchase Requests" count, "Pending Deliveries" count
- NO pricing data, NO supplier info, NO financial KPIs
- Big "Raise PR" button

## ANTHROPIC API KEY
Add to .env if not present:
```
VITE_ANTHROPIC_API_KEY=<the key — ask the user if not in .env>
```

---

## ===================================================
## SECTION 1: AI-POWERED QUOTE PARSING (Claude API)
## ===================================================

### WHAT: When a procurement person clicks "Review" on a pending quote, the system:
1. Shows the uploaded file (image/PDF preview)
2. Calls Claude API to read and extract ALL data from the file
3. Displays extracted data in editable form next to the file
4. Highlights missing fields in amber
5. User verifies/edits and saves

### 1A: Rewrite the Quote Review flow in src/pages/Quotes.tsx

When user clicks "Review" on a quote with parse_status = "pending" and raw_file_path exists:

Open a FULL-SCREEN dialog (DialogContent className="max-w-7xl h-[90vh] p-0"):

**Layout: Two panels side by side on desktop, stacked on mobile**

LEFT PANEL (lg:w-[55%], full on mobile) — File Preview:
```typescript
const { data: urlData } = supabase.storage.from('cps-quotes').getPublicUrl(quote.raw_file_path);
const fileUrl = urlData.publicUrl;
```
- Images (.jpeg/.png/.webp): `<img src={fileUrl} className="w-full" />`
- PDFs: `<iframe src={fileUrl} className="w-full h-full" />`
- Other: Download link with filename
- "Open in new tab" button at top

RIGHT PANEL (lg:w-[45%], full on mobile, overflow-y-auto) — AI Parsed Data:

### 1B: Claude API Call for Parsing

When the review dialog opens and quote has parse_status "pending", show a "Parse with AI" button.
On click, call Claude API:

```typescript
const parseQuoteWithAI = async (fileUrl: string, prLineItems: any[]) => {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    toast.error("Anthropic API key not configured. Add VITE_ANTHROPIC_API_KEY to .env");
    return null;
  }

  // Determine if file is image or PDF
  const isImage = /\.(jpg|jpeg|png|webp)$/i.test(fileUrl);
  const isPDF = /\.pdf$/i.test(fileUrl);

  const content: any[] = [];
  
  if (isImage) {
    content.push({
      type: "image",
      source: { type: "url", url: fileUrl }
    });
  } else if (isPDF) {
    content.push({
      type: "document",
      source: { type: "url", url: fileUrl }
    });
  } else {
    toast.error("Unsupported file type for AI parsing. Please review manually.");
    return null;
  }

  content.push({
    type: "text",
    text: `You are a procurement quote parser for Hagerstone International, a construction/interiors/MEP company in India.

Analyze this supplier quotation and extract ALL available commercial information.

The RFQ requested these items:
${prLineItems.map((item: any, i: number) => `${i + 1}. ${item.description} — Qty: ${item.quantity} ${item.unit || ''}`).join('\n')}

Return ONLY a valid JSON object (no markdown, no backticks, no explanation text before or after):
{
  "items": [
    {
      "description": "item name exactly as written in quote",
      "matched_pr_item_index": 0,
      "brand": "brand/make if mentioned",
      "quantity": 0,
      "unit": "unit",
      "rate": 0,
      "gst_percent": 18,
      "freight": 0,
      "packing": 0,
      "total_landed_rate": 0,
      "lead_time_days": null,
      "hsn_code": null
    }
  ],
  "payment_terms": "exact text or null",
  "delivery_terms": "exact text or null",
  "freight_terms": "included/extra/ex-works or null",
  "warranty_months": null,
  "validity_days": null,
  "total_quoted_value": 0,
  "total_landed_value": 0,
  "missing_fields": ["list every important field NOT found in the quote"],
  "notes": "important observations about this quote",
  "confidence": 80
}

Rules:
- rate = BASE rate per unit EXCLUDING GST
- total_landed_rate = rate × (1 + gst_percent/100) + freight + packing
- If a field is not in the quote, set null and ADD to missing_fields array
- missing_fields examples: "GST % not mentioned", "Delivery timeline missing", "Freight not specified", "Payment terms not stated", "Warranty not mentioned", "Validity period not stated"
- matched_pr_item_index = which PR item (0-based) this matches, or -1 if new item
- If quote has lump sum, divide by quantity for per-unit rate`
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content }],
    }),
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || "";
  const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(clean);
};
```

CRITICAL: Include these headers for browser-based API calls:
- `"x-api-key": apiKey` (NOT "Authorization: Bearer")
- `"anthropic-version": "2023-06-01"`
- `"anthropic-dangerous-direct-browser-access": "true"`

### 1C: Display Parsed Data in Right Panel

After AI returns data, show:

**Confidence Bar** — colored green (>80), amber (60-80), red (<60)

**⚠ Missing Fields Alert** (if any):
Amber box listing each missing field. Add text: "Contact supplier for these details"

**Editable Item Table:**
For each parsed item, show editable inputs in a card:
- Description (text, pre-filled)
- Matched PR Item (dropdown of PR line items)
- Brand (text)
- Rate ₹ (number)
- GST % (number, default 18)
- Freight ₹ (number, default 0)
- Packing ₹ (number, default 0)
- Landed Rate (auto-calc, read-only: rate × (1 + gst/100) + freight + packing)
- Lead Time days (number)

**Overall Terms (editable):**
- Payment Terms (textarea)
- Delivery Terms (textarea)
- Freight Terms (text)
- Warranty Months (number)
- Validity Days (number)
- Total Values (auto-calculated)

**AI Notes:** Show the AI's observations

### 1D: Save Review

"Confirm & Save Review" button:
```typescript
// 1. Update quote record
await supabase.from("cps_quotes").update({
  ai_parsed_data: parsedData,
  missing_fields: parsedData.missing_fields || [],
  ai_parse_confidence: parsedData.confidence,
  ai_summary: parsedData.notes,
  parse_status: "approved",
  compliance_status: "compliant",
  payment_terms: editedPaymentTerms,
  delivery_terms: editedDeliveryTerms,
  freight_terms: editedFreightTerms,
  warranty_months: parseInt(editedWarranty) || null,
  validity_days: parseInt(editedValidity) || null,
  total_quoted_value: totalQuoted,
  total_landed_value: totalLanded,
  reviewed_by: user.id,
  reviewed_at: new Date().toISOString(),
}).eq("id", quote.id);

// 2. Delete old line items, insert new
await supabase.from("cps_quote_line_items").delete().eq("quote_id", quote.id);

const lineItems = editedItems.map((item, idx) => ({
  quote_id: quote.id,
  pr_line_item_id: item.matched_pr_line_item_id || null,
  item_id: item.item_id || null,
  original_description: item.description,
  brand: item.brand || null,
  quantity: parseFloat(item.quantity) || 0,
  unit: item.unit || null,
  rate: parseFloat(item.rate) || 0,
  gst_percent: parseFloat(item.gst_percent) || 18,
  freight: parseFloat(item.freight) || 0,
  packing: parseFloat(item.packing) || 0,
  total_landed_rate: parseFloat(item.total_landed_rate) || 0,
  lead_time_days: parseInt(item.lead_time_days) || null,
  hsn_code: item.hsn_code || null,
  confidence_score: parsedData.confidence,
  human_corrected: true,
  ai_suggested: true,
}));
await supabase.from("cps_quote_line_items").insert(lineItems);

// 3. Update rfq_supplier status
await supabase.from("cps_rfq_suppliers")
  .update({ response_status: "responded" })
  .eq("rfq_id", quote.rfq_id).eq("supplier_id", quote.supplier_id);

// 4. Audit
await supabase.from("cps_audit_log").insert({
  user_id: user.id, user_name: user.name, user_role: user.role,
  action_type: "QUOTE_REVIEWED", entity_type: "quote",
  entity_id: quote.id, entity_number: quote.blind_quote_ref,
  description: `Quote ${quote.blind_quote_ref} reviewed. ${lineItems.length} items. Confidence: ${parsedData.confidence}%. Missing: ${(parsedData.missing_fields || []).length} fields.`,
  severity: "info",
});
```

### 1E: "Re-parse" button to re-run AI if needed

---

## ===================================================
## SECTION 2: COMPARISON SHEET (AI-Enhanced, User-Friendly)
## ===================================================

### WHAT: The comparison sheet is the decision-making tool for non-technical directors.
It must be clean, highlighted, and include AI recommendation.

### 2A: RFQ Page — Compare Button Logic

On /rfqs, each RFQ shows:
- Count of reviewed quotes: `{reviewed}/{total} quotes reviewed`
- "Compare →" when status = 'comparison_ready' AND ≥3 quotes with parse_status = 'approved'
- "Awaiting Quotes" when fewer than 3 reviewed

### 2B: Comparison Sheet Page (/comparison/:rfqId)

**Header:** RFQ number, project site, deadline, progress indicator

**Comparison Matrix Table:**
- ROWS = each PR line item
- COLUMNS = each supplier who has a reviewed quote (parse_status = 'approved')
- SHOW FULL SUPPLIER NAMES (Founder Rule 2)
- Each cell: Rate (large), Brand (small), Lead time (small), Landed rate (bold)
- Color per cell:
  - 🟢 GREEN bg = lowest landed rate for this item
  - 🟡 AMBER bg = 5-10% above benchmark (from cps_items.benchmark_rate)
  - 🔴 RED bg = >10% above benchmark
  - WHITE = acceptable range

**Summary Row per supplier:**
- Total Landed Value (₹, bold)
- Payment Terms, Delivery Terms, Warranty, Validity
- Rank (#1, #2, #3 by total landed value)

### 2C: AI Recommendation (Claude API)

After matrix renders, call Claude for recommendation:
```typescript
const getAIRecommendation = async (comparisonData: any) => {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: `You are a procurement advisor for Hagerstone International (construction company, India).

Analyze this comparison data and recommend the best supplier.

Weighting: Total landed cost (60%), Payment terms (15%), Delivery speed (15%), Warranty (10%).

Data: ${JSON.stringify(comparisonData)}

Return ONLY valid JSON (no markdown):
{
  "recommended_supplier_id": "uuid",
  "recommended_supplier_name": "name",
  "recommendation_reason": "2-3 sentences in simple English for a non-technical director",
  "ranking": [{"rank":1,"supplier_name":"","reason":""},{"rank":2,"supplier_name":"","reason":""}],
  "warnings": ["any red flags"],
  "potential_savings": "₹XX,XXX vs highest quote"
}`
      }]
    }),
  });
  const data = await response.json();
  const text = data.content?.[0]?.text || "";
  return JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
};
```

**Display:** Highlighted card with AI recommendation, ranking, warnings, savings.
Add: "This is a suggestion. The final decision is yours."

### 2D: Manual Review Panel (below matrix)

- "Your Notes" textarea
- "Select Vendor" dropdown (to agree or override AI)
- "Reason for Selection" textarea — REQUIRED
- "Mark as Reviewed" button → updates:
  ```
  manual_review_status: 'reviewed', manual_review_by: user.id,
  manual_review_at: NOW(), manual_notes, reviewer_recommendation: supplier_id,
  reviewer_recommendation_reason, ai_recommendation: aiResult
  ```

### 2E: Approval (procurement_head/management only)

After manual_review_status = 'reviewed':
- "Approve Vendor: [Name]" button
- "Reject" button (reason required)
- On Approve:
  ```
  status: 'approved', approved_by: user.id, approved_at: NOW(),
  recommended_supplier_id: chosen supplier, approval_reason: text
  ```
- After approval → show "Create PO" button

---

## ===================================================
## SECTION 3: PO AUTO-CREATION + APPROVAL + SEND + PDF
## ===================================================

### 3A: Create PO (from approved comparison)

When comparison is approved and user clicks "Create PO":

```typescript
const { data: poNum } = await supabase.rpc("cps_next_po_number", { prefix: "HI" });
const approvedSupplierId = comparisonSheet.recommended_supplier_id || comparisonSheet.reviewer_recommendation;

// Get the supplier's quote
const { data: quote } = await supabase.from("cps_quotes")
  .select("*").eq("rfq_id", rfqId).eq("supplier_id", approvedSupplierId)
  .eq("parse_status", "approved").order("created_at", { ascending: false }).limit(1).single();

// Get quote line items
const { data: qLineItems } = await supabase.from("cps_quote_line_items")
  .select("*").eq("quote_id", quote.id);

// Calculate totals
const totalValue = qLineItems.reduce((s, li) => s + (li.rate * li.quantity), 0);
const gstAmount = qLineItems.reduce((s, li) => s + (li.rate * li.quantity * ((li.gst_percent || 18) / 100)), 0);

// Insert PO
const { data: po } = await supabase.from("cps_purchase_orders").insert({
  po_number: poNum, rfq_id: rfqId, pr_id: rfq.pr_id,
  supplier_id: approvedSupplierId, comparison_sheet_id: comparisonSheet.id,
  status: "draft", project_code: pr.project_code,
  ship_to_address: pr.project_site,
  bill_to_address: "Hagerstone International (P) Ltd\nD-107, 91 Springboard Hub\nRed FM Road, Sector-2, Noida, UP\nGST: 09AAECH3768B1ZM",
  payment_terms: quote.payment_terms, delivery_date: pr.required_by,
  total_value: totalValue, gst_amount: gstAmount, grand_total: totalValue + gstAmount,
  created_by: user.id,
}).select("id, po_number").single();

// Insert PO line items
await supabase.from("cps_po_line_items").insert(qLineItems.map((li, idx) => ({
  po_id: po.id, item_id: li.item_id, description: li.original_description || li.normalised_description,
  brand: li.brand, quantity: li.quantity, unit: li.unit, rate: li.rate,
  gst_percent: li.gst_percent || 18,
  gst_amount: li.rate * li.quantity * ((li.gst_percent || 18) / 100),
  total_value: li.rate * li.quantity * (1 + (li.gst_percent || 18) / 100),
  hsn_code: li.hsn_code, sort_order: idx,
})));

// Update RFQ + PR status
await supabase.from("cps_rfqs").update({ status: "awarded" }).eq("id", rfqId);
await supabase.from("cps_purchase_requisitions").update({ status: "po_issued" }).eq("id", rfq.pr_id);

// Audit
await supabase.from("cps_audit_log").insert({
  user_id: user.id, user_name: user.name, user_role: user.role,
  action_type: "PO_CREATED", entity_type: "purchase_order",
  entity_id: po.id, entity_number: po.po_number,
  description: `PO ${po.po_number} created. Supplier: ${supplierName}. Total: ₹${(totalValue + gstAmount).toLocaleString()}`,
  severity: "info",
});
```

### 3B: PO List Page (/purchase-orders)

Table (desktop) / Cards (mobile) showing:
- PO Number, Supplier, Project, Grand Total, Status badge, Date
- "View" → PO document dialog
- "Approve & Send" → for procurement_head when status = 'draft'

### 3C: PO Document View (Hagerstone format)

Render as a styled div inside a dialog:
```
HAGERSTONE INTERNATIONAL (P) LTD
D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, UP
GST: 09AAECH3768B1ZM | Ph: +91 8448992353
procurement@hagerstone.com
─────────────────────────────────────
PURCHASE ORDER
PO Number: HI-PO-2026-XXXX    Date: DD/MM/YYYY
─────────────────────────────────────
TO:                        SHIP TO:
[Supplier Name]            [Project Site]
GSTIN: [XXXXX]
─────────────────────────────────────
# | Description | Brand | Qty | Unit | Rate | GST% | Amount
1 | Item Name   | Brand | 10  | Pcs  | 500  | 18%  | 5,900
─────────────────────────────────────
                     Sub-Total: ₹XX,XXX
                     GST:       ₹X,XXX
                     Grand Total: ₹XX,XXX
─────────────────────────────────────
Payment: [terms]
Delivery: [date/terms]
Penalty: 0.5% per week delay, max 5%
─────────────────────────────────────
Authorized Signatory: _____________
Hagerstone International (P) Ltd
```

### 3D: Download PDF

"Download PDF" button:
```typescript
const downloadPDF = () => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  printWindow.document.write(`<html><head><title>PO ${po.po_number}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:40px;color:#333}
      table{width:100%;border-collapse:collapse;margin:20px 0}
      th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:13px}
      th{background:#f5f0eb;font-weight:600}
      .header{text-align:center;border-bottom:3px solid #8B5E3C;padding-bottom:15px;margin-bottom:20px}
      .header h1{color:#5C3D1E;margin:0;font-size:20px}
      .totals td{text-align:right;font-weight:bold}
      .footer{margin-top:40px;border-top:1px solid #ccc;padding-top:20px}
      @media print{body{padding:20px}}
    </style></head><body>${poDocHTML}</body></html>`);
  printWindow.document.close();
  setTimeout(() => printWindow.print(), 500);
};
```

### 3E: Approve & Send PO

"Approve & Send" button (procurement_head only, status = 'draft'):
```typescript
await supabase.from("cps_purchase_orders").update({
  status: "sent", approved_by: user.id,
  approved_at: new Date().toISOString(),
  sent_at: new Date().toISOString(),
}).eq("id", po.id);

// Fire n8n webhook (non-blocking)
const { data: config } = await supabase.from("cps_config")
  .select("value").eq("key", "webhook_po_dispatch").single();
if (config?.value) {
  fetch(config.value, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "po_approved", po_id: po.id, po_number: po.po_number,
      supplier_id: po.supplier_id,
    }),
  }).catch(e => console.error("PO webhook error:", e));
  toast.success(`${po.po_number} approved and sent`);
} else {
  toast.success(`${po.po_number} approved. PO dispatch not configured yet.`);
}

// Audit
await supabase.from("cps_audit_log").insert({
  user_id: user.id, user_name: user.name, user_role: user.role,
  action_type: "PO_APPROVED", entity_type: "purchase_order",
  entity_id: po.id, entity_number: po.po_number,
  description: `PO ${po.po_number} approved and sent`, severity: "info",
});
```

---

## ===================================================
## SECTION 4: SMART RFQ — Per-Item Vendor Matching
## ===================================================

### WHAT: When a PR has items from different categories, the system finds the best 5 vendors
### per item category. If an item is not in the database, show an alert.

The DB function `cps_auto_create_rfq_for_pr` already handles this. But the PR form needs:

### 4A: Item Not Found Alert in PR Form

When user types an item name in the PR form that does NOT exist in cps_items:
- Show amber alert: "⚠ Item '[name]' not in database. The procurement team will be notified to add it."
- Still allow submission — the item goes as a manual entry with item_id = null
- When item_id is null, the auto-RFQ function uses 'General' category for supplier matching

### 4B: PR form should show item search with category

The item dropdown/search should show:
- Item name
- Category badge
- Benchmark rate (if exists)
- Last purchase rate (if exists)

When item is selected, auto-fill: description, unit, category info

### 4C: PR form — Project dropdown

The PR form should have a "Project / Site" dropdown that loads from `cps_projects` table:
```typescript
const { data: projects } = await supabase.from("cps_projects").select("id, name, site_address").eq("active", true);
```
Show project name in dropdown. When selected, auto-fill `project_site` with the site_address.
Also allow free-text entry for unlisted projects.

### 4D: Standard T&Cs in PO

All POs must include the company standard T&Cs. Load from `cps_config`:
```typescript
const configKeys = ['standard_payment_terms','standard_freight_terms','standard_penalty',
  'standard_warranty','quality_rejection_window','invoice_note','test_cert_note',
  'packing_note','damaged_material_note','design_variation_note'];
const { data: configs } = await supabase.from("cps_config").select("key, value").in("key", configKeys);
```
Display these as standard clauses at the bottom of every PO document.

---

## ===================================================
## SECTION 5: MOBILE RESPONSIVE
## ===================================================

### 5A: Bottom Navigation (NEW: src/components/layout/BottomNav.tsx)
```
lg:hidden fixed bottom-0 left-0 right-0 z-50
bg-sidebar text-sidebar-foreground
5 tabs: Dashboard | PRs | RFQs | POs | More(→Sheet)
Active = text-sidebar-primary
Height h-16, pb-4 for safe area
```

### 5B: Layout.tsx
- Sidebar: `hidden lg:flex`
- Main: `pb-20 lg:pb-0`
- Add <BottomNav />

### 5C: TopBar.tsx
- Role badge + date: `hidden sm:flex`

### 5D: ALL table pages → dual view
```tsx
<div className="hidden lg:block"><Table>...</Table></div>
<div className="lg:hidden space-y-3">{items.map(i=><Card>...</Card>)}</div>
```
Apply: PurchaseRequisitions, RFQs, Quotes, PurchaseOrders, SupplierMaster, ItemMaster, AuditLog

### 5E: Dashboard grid
- KPIs: `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3`

### 5F: Forms
- All grids: `grid grid-cols-1 md:grid-cols-2 gap-4`
- All buttons: `w-full sm:w-auto h-11`

### 5G: ComparisonSheet mobile
- Below lg: card-per-item view, suppliers ranked in each card

---

## ===================================================
## SECTION 6: PR HINDI LANGUAGE TOGGLE
## ===================================================

### WHAT: PR page has a language toggle button (EN/हिं)
When Hindi is active, all labels on the PR page and PR form switch to Hindi.

Create a simple translation map:
```typescript
const hindi = {
  "Purchase Requisitions": "खरीद अनुरोध",
  "New PR": "नया अनुरोध",
  "Project Site": "प्रोजेक्ट साइट",
  "Project Code": "प्रोजेक्ट कोड",
  "Required By Date": "आवश्यकता तिथि",
  "Notes": "टिप्पणी",
  "Items Required": "आवश्यक सामग्री",
  "Material Name": "सामग्री का नाम",
  "Quantity": "मात्रा",
  "Unit": "इकाई",
  "Submit PR": "अनुरोध जमा करें",
  "Save as Draft": "ड्राफ्ट सेव करें",
  "Cancel": "रद्द करें",
  "Add Item": "सामग्री जोड़ें",
  "Search items": "सामग्री खोजें",
  "PR Number": "अनुरोध संख्या",
  "Status": "स्थिति",
  "Raised On": "दिनांक",
  "View": "देखें",
};
```

Add a toggle button in the PR page header: `<Button size="sm" variant="outline">{lang === 'en' ? 'हिंदी' : 'English'}</Button>`

---

## ===================================================
## SECTION 7: VENDOR FEEDBACK FORM (Post-Delivery)
## ===================================================

### WHAT: After GRN is confirmed, a feedback form appears for the vendor.

On the Delivery Tracker page, after GRN is confirmed for a PO:
Show "Rate this Vendor" button.

Feedback dialog:
- Delivery Rating (1-5 stars)
- Quality Rating (1-5 stars)
- Packaging Rating (1-5 stars)
- Communication Rating (1-5 stars)
- Pricing Rating (1-5 stars)
- On-time delivery? (Yes/No toggle)
- Quantity accurate? (Yes/No)
- Any damage? (Yes/No + notes if yes)
- Would you recommend? (Yes/No)
- Additional notes (textarea)

On submit:
```typescript
const overall = (delivery + quality + packaging + communication + pricing) / 5;
await supabase.from("cps_vendor_feedback").insert({
  po_id, supplier_id, grn_id, rated_by: user.id,
  delivery_rating, quality_rating, packaging_rating,
  communication_rating, pricing_rating, overall_rating: overall,
  on_time_delivery, quantity_accurate, damage_reported, damage_notes,
  feedback_notes, would_recommend,
});

// Update supplier performance score (average of all feedback)
const { data: allFeedback } = await supabase.from("cps_vendor_feedback")
  .select("overall_rating").eq("supplier_id", supplier_id);
const avgScore = allFeedback.reduce((s, f) => s + f.overall_rating, 0) / allFeedback.length;
await supabase.from("cps_suppliers").update({
  performance_score: Math.round(avgScore * 20), // 1-5 → 0-100
}).eq("id", supplier_id);
```

---

## ===================================================
## DB CONSTRAINTS — WILL CAUSE 400 ERRORS IF VIOLATED
## ===================================================

| Table | Field | Valid Values |
|-------|-------|-------------|
| cps_purchase_requisitions.status | varchar | pending, validated, duplicate_flagged, rfq_created, po_issued, delivered, cancelled |
| cps_rfqs.status | varchar | draft, sent, reminder_1, reminder_2, reminder_3, closed, comparison_ready, negotiating, approved, awarded, cancelled |
| cps_rfq_suppliers.response_status | varchar | pending, responded, non_responsive, declined |
| cps_quotes.parse_status | varchar | pending, parsing, parsed, needs_review, approved, rejected |
| cps_quotes.channel | varchar | email, whatsapp, portal, phone |
| cps_comparison_sheets.status | varchar | draft, under_review, approved, rejected |
| cps_purchase_orders.status | varchar | draft, sent, acknowledged, dispatched, partial_delivered, delivered, closed, cancelled |
| cps_grns.status | varchar | pending, approved, disputed |
| cps_purchase_orders.po_number | NOT NULL | MUST call cps_next_po_number('HI') first |
| cps_audit_log timestamp | logged_at | NEVER use created_at — it doesn't exist |
| cps_quotes.blind_quote_ref | auto-generated | NEVER set manually — trigger handles it |

## HAGERSTONE COMPANY DETAILS:
- Hagerstone International (P) Ltd
- GST: 09AAECH3768B1ZM
- D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, UP
- Ph: +91 8448992353 | procurement@hagerstone.com

## RULES — BREAK THESE AND THE APP CRASHES:
1. NEVER modify src/components/ui/ files
2. NEVER hardcode colors — CSS variables only
3. ALWAYS use logged_at for cps_audit_log
4. ALWAYS call cps_next_po_number('HI') before PO insert
5. Console.error on EVERY Supabase error
6. All buttons min h-11 on mobile
7. Use shadcn/ui for all components
8. blind_quote_ref auto-generated — never set it
9. Storage URL: supabase.storage.from('cps-quotes').getPublicUrl(path)
10. Claude API headers: x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access

## FINAL VERIFICATION:
```bash
npx tsc --noEmit 2>&1 | grep -v "components/ui" | grep -v "supabase/client"
npx vite build
```
Both must pass. Fix any errors before declaring done.
