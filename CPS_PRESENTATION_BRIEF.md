# Hagerstone CPS — Presentation Brief

> Document to generate a slide deck from. Each `##` section = one slide (or a small group of slides). Each `###` = a sub-section. Bullets are speaker notes / slide content.

---

## 1. Title Slide

- **Hagerstone Centralised Procurement System (CPS)**
- AI-assisted procurement, end-to-end, for construction / interiors / MEP / EPC projects
- Built on React + Supabase + Claude AI + n8n
- Live at: hagerstone-cps.vercel.app
- Client: Hagerstone International Pvt. Ltd.

---

## 2. The Problem

Before CPS, procurement at Hagerstone was:
- **Manual and phone-driven** — site engineers called procurement with material needs
- **Spreadsheets everywhere** — PRs, RFQs, quotes, POs all in separate Excel files
- **Vendor bias risk** — same vendors getting orders repeatedly with no fair rotation
- **No price benchmarks** — no way to know if a quote was fair
- **Zero audit trail** — disputes 6 months later had no supporting data
- **Approvals by WhatsApp forwards** — lost, unsigned, untraceable

**Result:** slow cycle times, inconsistent pricing, no accountability.

---

## 3. The 5 Non-Negotiable Outcomes

The CPS was built to guarantee:
1. **Zero corruption, commissions, or bribes**
2. **Best possible market rates**
3. **Fair and equal treatment of all suppliers**
4. **Best credit / payment terms**
5. **Complete transparency and full auditability**

Every feature in the system traces back to one of these 5.

---

## 4. The 21-Step Procurement Workflow

From material request to delivery, every step is tracked:

1. **PR Intake** — Requestor submits via web form
2. **Duplicate Check** — Auto-detects similar recent PRs
3. **Supplier Identification** — Auto-selects 5+ suppliers by category + region
4. **RFQ Creation & Dispatch** — Auto-generated, sent via WhatsApp
5. **Reminder Sequence** — D+1 polite, D+2 firm, D+3 final
6. **Quote Collection** — Portal / WhatsApp / email
7. **Quote Parsing** — Claude AI extracts structured data from PDFs
8. **Missing Data Detection** — Flags incomplete fields
9. **Clarification Loop** — Max 2 rounds, then marked non-compliant
10. **Quote Comparison** — Auto-generated matrix with rankings
11. **Market Benchmarking** — Compared against 198 historical records
12. **Anomaly & Fraud Detection** — Collusion signals, outliers
13. **Negotiation / Counter-Offer** — If > 5% above benchmark
14. **T&C Standardisation** — Flags deviations
15. **Final Recommendation Package** — AI + human review
16. **MANUAL APPROVAL** ← Only human decision (Procurement Head / Management / Founder)
17. **PO Auto-Generation** — Branded PDF, digitally approved
18. **PO Dispatch & Acknowledgement**
19. **Dispatch Follow-Up** — Pre-dispatch check, e-way bill
20. **Delivery Tracking** — Transporter, ETA, events
21. **GRN & Closure** ← Second human touchpoint (Site Receiver confirms)

**Only 3 human touchpoints in 21 steps.** Everything else runs on its own.

---

## 5. User Roles

7 roles, each with tailored permissions:

| Role | Key Permissions |
|------|----------------|
| `requestor` | Submit PRs, confirm delivery |
| `procurement_executive` | Manage RFQs, review quotes |
| `procurement_head` / `it_head` | Approve POs up to ₹5L, full access |
| `management` | Approve POs above ₹5L, view dashboards |
| `finance` | View POs for payment, verify GRNs |
| `site_receiver` | Record GRN, log damage / shortage |
| `auditor` | Read-only access to everything |

Role-based dashboards, route guards, and price-visibility controls.

---

## 6. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| UI | shadcn/ui + Tailwind CSS |
| State | TanStack React Query |
| Backend / DB | Supabase PostgreSQL (23 CPS tables) |
| Auth | Supabase Auth (email/password + Google OAuth) |
| Storage | Supabase Storage (quote PDFs, PO PDFs, PR images) |
| AI | Claude Opus 4.5 + Sonnet 4 + Haiku 4.5 |
| Automation | n8n workflows (Railway-hosted) |
| Comms | WhatsApp Business API via n8n |
| PDF | jsPDF + jspdf-autotable |
| Deployment | Vercel |

---

## 7. AI Integration — Claude at the Core

**9 places where Claude AI works inside the system:**

| Purpose | Model |
|---------|-------|
| Comparison Sheet full analysis | Claude Opus 4.5 |
| Vendor quote file parsing (PDF → structured data) | Claude Opus 4.5 |
| Legacy quote / PO upload parsing | Claude Opus 4.5 |
| Bulk invoice parsing (Google Drive import) | Claude Sonnet 4 |
| Quick supplier profile extraction | Claude Haiku 4.5 |
| Inline quote review extraction | Claude Sonnet 4 |

**Routed through a single Supabase Edge Function (`claude-proxy`)** so the API key never touches the browser.

---

## 8. Key Feature — Comparison Sheet (AI-Powered)

When 2+ quotes arrive for an RFQ, the Comparison Sheet auto-loads with:
- **Executive Summary** — plain-English summary of the bids
- **Supplier Profiles** — strengths, weaknesses, risk flags per vendor
- **Item-by-Item Comparison** — intelligently grouped (aligns similar items across vendors even with different names)
- **Commercial Analysis** — lowest / highest / price spread %
- **AI Recommendation** — vendor pick with reasoning, ranking, potential savings
- **Head's Decision** (green card alongside AI) — with "Matches AI" / "Override AI" tag
- **Vendor Quote Files** — original PDFs/images embedded for visual verification
- **Warnings & Next Steps** — concrete actions for procurement
- **One-click export** — CSV or PDF, identical to on-screen layout

**The PDF is shareable with founders** — decision-grade, auditable.

---

## 9. Key Feature — Purchase Orders

- **Auto-generated PO PDF** with Hagerstone branding (logo, GST, address)
- **Auto-numbered** (`HI-PO-2026-XXXX`)
- **Editable** before founder approval — procurement head can fix any AI parsing errors
- **Supplier Bank Details** filled inline by procurement before approval
- **Founder approval** via WhatsApp link (token-based public page)
- **Line items** auto-pulled from recommended quote
- **Payment schedule** with milestones (Advance / On Delivery / Balance)
- **Self-approval blocked** — creator cannot approve their own PO (anti-corruption)
- **Amount in words** rendered in Indian format (Crore / Lakh / Thousand)

---

## 10. Key Feature — Kanban Pipeline

A full end-to-end pipeline view of every active PR:

```
[PR Raised] → [RFQ Sent] → [Quotes Received] → [Comparison Review] →
[Pending Approval] → [PO Sent] → [In Delivery] → [Delivered] → [Closed]
```

Each card shows:
- PR number + priority badge (🔥 Urgent / ↑ High / Normal / ↓ Low)
- Duplicate warning icon if flagged
- Project, requester, age (red > 14d, amber > 7d)
- Item count, RFQ number, PO number, supplier, grand total
- Click-through to source page

**Zero ambiguity about where anything is stuck.**

---

## 11. Key Feature — Analytics Dashboard

Procurement intelligence at a glance:

- **8 KPI cards** — Total Spend, Avg PO Value, Active POs, On-Time Delivery %, Benchmark Variance, Suppliers Used, Projects, PR→PO Rate
- **5 tabs:**
  - By Project — spend per project with bar charts
  - By Supplier — top 10 + leaderboard (POs, spend, on-time %, score)
  - By Category — material category spend
  - Monthly Trend — 12-month spend chart
  - PO Status Distribution
- **Detailed Project Breakdown** table with % of total
- **Quality Alerts** — late deliveries, price overruns
- **CSV export** — full snapshot

---

## 12. Anti-Corruption Controls (Hard-Coded)

These cannot be bypassed:

1. Every RFQ must go to **minimum 5 suppliers**
2. At least 2 suppliers per RFQ **not awarded in last 90 days** (fair rotation)
3. **No self-approval** of POs (creator ≠ approver)
4. **Audit log is append-only** — no UPDATE or DELETE allowed
5. **PO blocked** if approval record is missing
6. **Blind quotations** during review — supplier identity hidden (`QT-2026-XXXX`)
7. **Supplier win rate > 40%** per quarter → triggers review flag
8. **All manual overrides** require documented reason
9. **Quotes after RFQ deadline** are blocked automatically
10. **GSTIN mandatory** for all new vendor additions

---

## 13. Data Assets (Seeded)

The system starts with real Hagerstone data:

- **580 suppliers** — actual vendors from invoice history
- **161 materials** — across 11 categories (HVAC, Plumbing, Interiors, Electrical, etc.)
- **198 benchmark rates** — from real invoice records
- **43 invoices** — historical for ML / comparison context

**Not a demo dataset — this is live operational data.**

---

## 14. Automation via n8n

**3 automated workflows:**

1. **`build-1-rfq-dispatch`** — triggered on PR submit → sends RFQ to 5+ suppliers via WhatsApp with unique upload link
2. **`build-5-founder-approval`** — triggered on PO creation → WhatsApp to founders with approve / reject buttons
3. **Quote parse webhook** — triggered when vendor uploads file → Claude AI extracts structured data

**WhatsApp-first** because email open rates from Indian construction vendors are ~20%, while WhatsApp is ~90%.

---

## 15. Recent Improvements (Today's Work — Apr 14, 2026)

12 commits shipped in one day:

- PR Review dialog: return to `/requisitions` after close
- Fixed PO PDF column overflow and bank section layout
- Added supplier bank details on PO + editable supplier details inline
- Fixed Pending Approvals count + made quote reference optional
- Showed PR site reference images in Review + made GSTIN mandatory for vendors
- **AI-driven Comparison Sheet** — auto-generate, Head's Decision card, vendor quote file viewer, matching PDF/CSV
- Added time to dates, status tabs & KPI cards on PR page, with inline review flow
- Show legacy PO details properly in view dialog
- Added error state + retry UI to Quotes page
- Added error state + retry UI to DeliveryTracker
- Handled stale-chunk errors after Vercel redeploys
- Pre-filter Purchase Orders by status from URL query param

---

## 16. What the System Prevents

| Without CPS | With CPS |
|-------------|----------|
| Single vendor favouritism | Min 5 suppliers per RFQ + fresh-supplier rotation |
| Inflated rates | Benchmark comparison + AI anomaly detection |
| Approvals on WhatsApp forwards | Token-based approval links, logged |
| Lost paperwork | Every action in append-only audit log |
| Manual PO Word docs | Branded, digitally approved PDFs |
| "Did we order this?" | Kanban pipeline shows exact status |
| Price disputes 6 months later | Vendor quote file viewable on every PO |

---

## 17. Measurable Outcomes

(Fill these in based on real usage once you have 3 months of data)

- ⏱ **Average PR-to-PO cycle time:** _X days → Y days_
- 💰 **Savings vs benchmark:** _X%_ average
- ✅ **On-time delivery rate:** _Y%_
- 📊 **Supplier pool utilisation:** _N_ unique vendors / month (vs top-3 dominance before)
- 🔍 **Audit trail completeness:** 100% of actions logged
- 📄 **Document recovery time:** < 10 seconds (vs hours on email / WhatsApp)

---

## 18. Architecture Diagram

```
[Site Engineer] → Submits PR → [React App]
                                    ↓
                                [Supabase DB] ← → [Supabase Edge Function: claude-proxy]
                                    ↓                       ↓
                                [n8n Webhook]         [Claude Opus / Sonnet / Haiku]
                                    ↓
                            [WhatsApp to 5+ Vendors]
                                    ↓
                            [Vendor uploads quote via token URL]
                                    ↓
                            [AI parses quote]
                                    ↓
                            [Procurement reviews comparison sheet]
                                    ↓
                            [PO created → PDF generated]
                                    ↓
                            [Founders approve via WhatsApp link]
                                    ↓
                            [Supplier delivers → GRN → PO closed]
```

---

## 19. Roadmap — What's Next

- **AI-based fraud & collusion detection** (needs 12+ months of transaction history)
- **Tofler / Zauba benchmark integration** (paid data provider)
- **Transporter API integration** for top 3 transporters (VRL, TCI, DTDC)
- **Multi-level approval chains** — configurable by project value
- **Budget tracking** — project-level spend vs budget
- **Invoice 3-way matching** — PO ↔ GRN ↔ Invoice auto-reconcile
- **Mobile PWA** — already works on mobile browsers; could add native wrapper
- **Supplier self-service portal** — vendors see their own order history, payment status

---

## 20. Closing Slide — Why This Matters

- Procurement is typically **the most fraud-prone function** in construction
- CPS doesn't trust people to be honest — it **makes it structurally impossible** to misbehave (5-supplier minimum, blind quotes, no self-approval, append-only audit)
- **AI augments, humans decide** — Claude analyses, head approves. Every decision has a named signer
- **Built for non-technical users** — site engineers raise PRs in 30 seconds; founders approve POs by tapping a WhatsApp link
- **Transparent to founders** — every PDF is shareable, every number is explainable

**The system is operational, not theoretical.**

---

## Suggested Slide Count: 18–20

Use sections 1–19 as slides; section 20 as closing. Combine 4+5 (workflow + roles) into a single architecture slide if you want fewer slides. Put sections 15 (recent work) + 16 (prevention) + 17 (outcomes) on appendix slides for Q&A.

## Visual Suggestions

- **Slide 4** (21-step workflow): horizontal flow diagram with icons
- **Slide 7** (AI usage): table with Claude model logos
- **Slide 8** (Comparison Sheet): screenshot of the actual comparison sheet page
- **Slide 10** (Kanban): screenshot of Kanban board
- **Slide 11** (Analytics): screenshot of spend-by-project tab
- **Slide 18** (Architecture): clean flowchart with arrows
- **Slide 20** (Closing): single bold statement, brown/gold Hagerstone colours

## Design System (use Hagerstone colours)

- Primary brown: `hsl(20, 50%, 35%)` (#8B5E3C)
- Gold accent: `hsl(45, 85%, 65%)`
- Background: off-white / cream
- Body text: near-black / dark gray
