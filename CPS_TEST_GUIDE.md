# Hagerstone CPS — Complete Testing Guide
# Test the entire system from Step 1 to Step 21
# Follow in exact order. Note any failures.
# Date: March 2026

---

## TEST CREDENTIALS
- URL: http://localhost:5173
- Email: admin@hagerstone.com
- Password: Hagerstone@2026
- Role: Procurement Head (sees everything)

## CURRENT DB STATE (before testing)
- Users: 1 (Aniket Awasthi — Procurement Head)
- Suppliers: 14 (seeded from real invoice data)
- Items: 153 (seeded from real materials)
- Benchmarks: 198 (seeded from real invoices)
- PRs, RFQs, Quotes, POs, GRNs: 0 (all empty — starting fresh)

---

## MODULE 1 — LOGIN & NAVIGATION

### Test 1.1 — Login
1. Open http://localhost:5173
2. Should redirect to /login
3. Enter email: admin@hagerstone.com, password: Hagerstone@2026
4. Click Sign In

✅ PASS if: Redirects to /dashboard, shows "Welcome, Aniket 👋"
❌ FAIL if: Error message, stays on login, or blank screen

---

### Test 1.2 — Dashboard KPI Cards
After login, on /dashboard:
1. Should see 6 KPI cards: Total PRs (0), Active RFQs (0), Quotes Pending Review (0),
   Active POs (0), Pending GRNs (0), Total Suppliers (14)
2. Should see 2 extra cards (Proc Head role): Total PO Value (₹0), Avg Savings

✅ PASS if: All cards load with numbers (not spinning indefinitely)
❌ FAIL if: Cards show error or stay on loading skeleton

---

### Test 1.3 — Sidebar Navigation
Click every sidebar link in order and verify the page loads:
| Link | URL | Expected |
|------|-----|----------|
| Dashboard | /dashboard | KPI cards |
| Purchase Requests | /requisitions | Empty table with "New PR" button |
| RFQs | /rfqs | Empty table with "Create RFQ" button |
| Quotes | /quotes | Empty table with "Log Quote Manually" button |
| Comparison | /comparison | "Select an RFQ" message |
| Purchase Orders | /purchase-orders | Empty table with "Create PO" button |
| Delivery Tracker | /delivery | Empty state |
| Supplier Master | /suppliers | Table with 14 suppliers |
| Item Master | /items | Table with 153 items |
| Audit Log | /audit | Empty table (no logs yet) |

✅ PASS if: All 10 pages load without blank screen or error
❌ FAIL if: Any page shows error, crashes, or stays blank

---

### Test 1.4 — Public Vendor Registration Page
1. Open a new tab: http://localhost:5173/vendor/register
2. Should load WITHOUT being redirected to login

✅ PASS if: Registration form loads with Hagerstone header, no login required
❌ FAIL if: Redirects to /login

---

## MODULE 2 — SUPPLIER MASTER

### Test 2.1 — View Suppliers
Go to /suppliers
1. Should see 14 supplier rows in table
2. Check columns: Name, GSTIN, Location, Contact, Performance Score, Status

✅ PASS if: 14 rows load, data is visible
❌ FAIL if: Empty table or loading forever

---

### Test 2.2 — Search Suppliers
In the search box, type "ADITYA"
1. Should filter to show only suppliers with "ADITYA" in name

✅ PASS if: Filtered results show
❌ FAIL if: No filtering happens

---

### Test 2.3 — Add New Supplier
Click "Add Supplier" button:
1. Fill: Company Name = "Test Supplier Pvt Ltd"
2. Fill: GSTIN = "07TESTGS0000B1Z0"
3. Fill: Email = "test@testsupplier.com"
4. Fill: Phone = "+91 9800000001"
5. Fill: City = "Delhi", State = "Delhi"
6. Fill: Categories = "Civil Works, MEP"
7. Click "Add Supplier"

✅ PASS if: Toast "Supplier added", list refreshes showing 15 suppliers
❌ FAIL if: Error toast, or supplier doesn't appear

---

## MODULE 3 — ITEM MASTER

### Test 3.1 — View Items
Go to /items
1. Should see 153 items
2. Stats cards: Total Items (153), Categories (count), With Benchmark (number)

✅ PASS if: 153 items load
❌ FAIL if: Empty or error

---

### Test 3.2 — Category Filter
1. Click any category chip (e.g. "Electrical")
2. Table should filter to only that category

✅ PASS if: Filtered list shows
❌ FAIL if: No filter effect

---

### Test 3.3 — Benchmark Indicator
Look at item rows:
1. Items where last_purchase_rate > benchmark_rate by >5% should show red "▲ X% above benchmark"
2. Items where rate is good should show green "✓ Good rate"

✅ PASS if: Indicators visible on relevant rows
❌ FAIL if: All rows show "—" (may mean benchmark_rate is null for all — acceptable)

---

### Test 3.4 — Edit Item
Click "Edit" on any item:
1. Dialog opens with pre-filled data
2. Change benchmark_rate to any number
3. Click "Save Changes"

✅ PASS if: Toast "Item updated", list refreshes
❌ FAIL if: Error or no change

---

## MODULE 4 — PURCHASE REQUISITIONS (Step 1 of workflow)

### Test 4.1 — Empty State
Go to /requisitions
1. Should see empty state: icon + "No purchase requisitions yet" + "Raise your first PR" button

✅ PASS if: Clean empty state
❌ FAIL if: Error or blank

---

### Test 4.2 — Create PR (PR-2026-0001)
Click "New PR":
1. Fill Project Site: "Noida Site A — Block 3"
2. Fill Project Code: "HI-2026-NOI-01"
3. Fill Required By: (pick a date 2 weeks from today)
4. Fill Notes: "Urgent requirement for fire system installation"
5. In Line Items — Row 1:
   - Select from master: "LT PANEL COMPELETE" (or any item from dropdown)
   - Description: auto-fills
   - Quantity: 2, Unit: SET
   - Required for Which Work: "Main electrical panel for Floor 1"
6. Click "+ Add Item" — Row 2:
   - Type manually (no item master): "Fire Hose Pipe - 63mm"
   - Quantity: 25, Unit: Nos
   - Required for Which Work: "Fire hydrant system installation"
   - Preferred Brand: "Newage / Safex"
7. Click "Submit PR" (not Save Draft)

✅ PASS if: Toast "PR-2026-0001 submitted successfully", appears in list with status "Submitted"
❌ FAIL if: Error, no PR number generated, or stays on dialog

---

### Test 4.3 — View PR Detail
Click on PR-2026-0001 row (or View button):
1. Detail dialog opens showing project site, code, required by date
2. Line items table shows both items with quantities

✅ PASS if: Dialog opens with correct data
❌ FAIL if: Empty dialog or error

---

### Test 4.4 — View PR as Document
Click the printer icon / "View as Document" button on the PR row:
1. Should show Hagerstone formatted document
2. Headers: Hagerstone logo area, "Material Issued at Site", Serial No: PR-2026-0001
3. Table with line items in Hagerstone format
4. "Raised By: Aniket Awasthi" at bottom

✅ PASS if: Formatted document dialog opens
❌ FAIL if: Button not present or dialog empty

---

### Test 4.5 — Create a Second PR (for RFQ testing)
Create one more PR:
1. Project Site: "Gurgaon Site B"
2. Project Code: "HI-2026-GGN-02"
3. Required By: 3 weeks from today
4. Line Items:
   - "Butterfly Valve 100NB" | Qty: 10 | Nos | Work: "Plumbing system"
   - "Gate Valve 200NB" | Qty: 5 | Nos | Work: "Main water supply line"
5. Submit PR

✅ PASS if: PR-2026-0002 appears in list
❌ FAIL if: Error or same PR number as first

---

## MODULE 5 — RFQs (Steps 3-5 of workflow)

### Test 5.1 — Empty State
Go to /rfqs
1. Should see empty table with "Create RFQ" button

✅ PASS if: Clean empty state
❌ FAIL if: Error

---

### Test 5.2 — Create RFQ (Anti-Corruption Test)
Click "Create RFQ":

STEP 1 — Details:
1. Select PR: "PR-2026-0001 — Noida Site A — 2 items"
2. Title: auto-fills to "RFQ for Noida Site A — Block 3" (verify auto-fill works)
3. Deadline: pick a date 5 days from today
4. Payment Terms: leave as default "Payment within 60 days..."
5. Click "Next →"

STEP 2 — Supplier Selection:
1. Counter shows "0 selected of 5 minimum" in red
2. Select only 3 suppliers → counter turns "3 of 5 minimum" (still red)
3. Try clicking "Next →"

✅ PASS if: Blocked — shows error "Select at least 5 suppliers"
❌ FAIL if: Allows proceeding with fewer than 5

4. Select 5 total suppliers — counter turns green "5 of 5 minimum ✓"
5. Check Fresh suppliers counter — need at least 2 with "Fresh" badge
   (All 14 seeded suppliers have last_awarded_at = NULL so all should be "Fresh")
6. Click "Next →"

STEP 3 — Review:
1. Summary shows: PR linked, deadline, 5 suppliers, fresh count
2. "Create RFQ" button is enabled (green)
3. Click "Create RFQ"

✅ PASS if: Toast "RFQ-2026-0001 created with 5 suppliers"
✅ PASS if: PR-2026-0001 status changes to "RFQ Sent" in /requisitions
❌ FAIL if: Error, wrong supplier count, or PR status not updated

---

### Test 5.3 — Verify Anti-Corruption Minimum Supplier Rule
Create a second RFQ:
1. Select PR-2026-0002
2. Try to submit with only 4 suppliers selected
3. Should be blocked with error

✅ PASS if: Hard block with error message
❌ FAIL if: Allows creating with fewer than 5

---

## MODULE 6 — QUOTES (Steps 6-9, Blind Quote System)

### Test 6.1 — Log Quote Manually (Quote 1)
Go to /quotes, click "Log Quote Manually":
1. Select RFQ: "RFQ-2026-0001"
2. Select Supplier: any supplier from the dropdown (e.g. "ACE COMMUNICATION AND ELECTRONICS")
3. Supplier's Quote Reference: "2025-26-074"
4. Channel: Email
5. Received Date: today
6. Payment Terms: "100% Advance"
7. Delivery Terms: "2 weeks after PO confirmation"
8. Warranty: 12 months
9. Price Validity: 7 days
10. Grand Total Quoted: 85000
11. GST %: 18
12. Click Submit

✅ PASS if: Toast "Quote logged successfully", appears in table as "QT-2026-0001"
✅ PASS if: Table shows QT-2026-0001 — NO supplier name visible in the list
❌ FAIL if: Supplier name appears in the table (blind system broken)
❌ FAIL if: Error on submit

---

### Test 6.2 — Verify Blind Quote System
Look at the quotes table:
1. Column 1 (Blind Ref) should show "QT-2026-0001" in monospace
2. NO column should say "Supplier: ACE COMMUNICATION..."
3. The supplier identity should be completely hidden

✅ PASS if: Only QT-XXXX visible, no supplier name
❌ FAIL if: Supplier name visible anywhere in the list

---

### Test 6.3 — Log 4 More Quotes (for comparison testing)
Log 4 more quotes for RFQ-2026-0001 with different suppliers:

Quote 2: Supplier="ADITYA SALES", Ref="Q-ADI-001", Total=92000, GST=18%, Payment="60 days"
Quote 3: Supplier="AAZAD GYPSUM PLASTER", Ref="AGP-2026-03", Total=78500, GST=18%, Payment="30 days"
Quote 4: Supplier="Aakriti Design Studio", Ref="ADS-Q-001", Total=95000, GST=18%
Quote 5: Supplier="ADINATH PLY AND DECOR", Ref="APD-001", Total=88000, GST=18%

After all 5 logged: stats should show Total Quotes = 5

✅ PASS if: All 5 appear as QT-2026-0001 through QT-2026-0005
❌ FAIL if: Error on any quote or blind refs not sequential

---

### Test 6.4 — Review a Quote
Click "Review" on QT-2026-0001:
1. Dialog opens with "QT-2026-0001" prominent at top
2. NO supplier name in dialog header
3. 3 tabs visible: Line Items | Terms & Conditions | Summary
4. Terms tab shows: Payment Terms "100% Advance", Delivery "2 weeks...", Warranty "12 months"
5. Summary tab shows total values

✅ PASS if: Dialog loads with 3 tabs, blind ref prominent, no supplier name
❌ FAIL if: Supplier name visible or tabs missing

---

### Test 6.5 — Mark Quote as Reviewed
In the review dialog:
1. Click "Mark as Reviewed"
2. Parse status should update to "Reviewed" (green badge)

✅ PASS if: Toast success, badge changes to green "Reviewed"
❌ FAIL if: Error or no change

---

## MODULE 7 — COMPARISON SHEET (Steps 10-11)

### Test 7.1 — Navigate to Comparison Sheet
Go to /rfqs, find RFQ-2026-0001:
1. Look for "Compare →" button on the row
   NOTE: Button only appears if status = 'comparison_ready' or later
   RFQ status may still be 'draft' — if no button, manually navigate to:
   http://localhost:5173/comparison/[RFQ-ID]
   (Get RFQ ID from Supabase or browser network tab)

✅ PASS if: Comparison page loads showing "No Comparison Sheet Yet" with Generate button
❌ FAIL if: 404 error or crashes

---

### Test 7.2 — Generate Comparison Sheet
Click "Generate Comparison Sheet":
1. Sheet is created in DB
2. Page reloads showing the comparison matrix
3. Header shows: "5 quotes received", supplier names as column headers
4. Rows = items from PR line items

✅ PASS if: Matrix visible with supplier names in columns (NOT blind refs)
✅ PASS if: Lowest rate cell highlighted green
❌ FAIL if: Supplier names still hidden (founder rule violated)
❌ FAIL if: Matrix is empty or crashes

---

### Test 7.3 — Manual Review Panel
Scroll to "Procurement Executive Review" section:
1. Status shows "pending" (amber badge)
2. Fill Reviewer Notes: "Supplier 3 (AAZAD GYPSUM PLASTER) offers best price at ₹78,500"
3. Select Recommended Supplier from dropdown
4. Fill Recommendation Reason: "Lowest landed cost, 30-day payment terms favorable"
5. Click "Save Draft"

✅ PASS if: Toast "Notes saved", status changes to "in_review"
❌ FAIL if: Error or no status change

6. Click "Mark as Reviewed"

✅ PASS if: Toast success, status changes to "reviewed" (green)
❌ FAIL if: Error or validation message (if notes/recommendation missing)

7. Click "Send for Approval"

✅ PASS if: Status changes to "sent_for_approval" (purple)
❌ FAIL if: Error

---

## MODULE 8 — PURCHASE ORDERS (Steps 16-17)

### Test 8.1 — Create PO
Go to /purchase-orders, click "Create PO":
1. Select RFQ dropdown should show RFQ-2026-0001 (sent_for_approval)
2. On selection: supplier auto-fills, line items appear
3. Fill Delivery Date: 2 weeks from today
4. Verify Grand Total auto-calculates
5. Click "Create PO"

✅ PASS if: Toast "PO HI-PO-2026-0001 created — pending approval"
✅ PASS if: PO appears in list with status "Awaiting Approval" (amber)
❌ FAIL if: RFQ not in dropdown, or error on create

---

### Test 8.2 — View PO Document
Click "View" on HI-PO-2026-0001:
1. Document dialog opens showing:
   - Hagerstone letterhead (logo area, GST, address)
   - Supplier details section
   - Line items table with Sr.No, Description, Brand, HSN, Qty, Unit, Rate, GST%, Total
   - Sub Total, GST Amount, Grand Total rows
   - Terms section
   - Approval section (amber box "This PO requires your approval")

✅ PASS if: Formatted PO document renders with all sections
❌ FAIL if: Empty dialog or missing sections

---

### Test 8.3 — Approve PO
In the PO detail dialog:
1. "Approve PO" button is visible (Proc Head role has canApprove)
2. Add Approval Notes: "Approved — best rate from comparison"
3. Click "Approve PO"

✅ PASS if: Toast "PO approved", status changes to "Approved" (green)
✅ PASS if: "Approved by Aniket Awasthi on [date]" shows in dialog
❌ FAIL if: Error or button not visible

---

### Test 8.4 — Send to Supplier
After approval, in the PO detail:
1. "Send to Supplier" blue button appears
2. Click it

✅ PASS if: Toast success, status changes to "Sent" (blue)
❌ FAIL if: Error or button missing

---

## MODULE 9 — DELIVERY TRACKER (Steps 19-21)

### Test 9.1 — View Delivery Tracker
Go to /delivery:
1. HI-PO-2026-0001 card should appear (status: Sent)
2. Timeline shows: ✅ PO Sent, ⬜ Acknowledged, ⬜ Dispatched, etc.

✅ PASS if: PO card visible with timeline
❌ FAIL if: Empty state or no card

---

### Test 9.2 — Add Dispatch Update
Click "Add Update" on the PO card:
1. Select Event Type: "dispatched"
2. Event Date: today
3. LR/Tracking Number: "UP12345AB2026"
4. Transporter: "Ashoka Transport"
5. E-Way Bill: "EWB12345678"
6. Quantity Dispatched: 2
7. Expected Delivery Date: 3 days from today
8. Click Submit

✅ PASS if: Toast success, timeline updates showing ✅ Dispatched with LR number
❌ FAIL if: Error or timeline not updating

---

### Test 9.3 — Add In Transit Update
Click "Add Update" again:
1. Event Type: "in_transit"
2. Event Date: today + 1 day
3. Expected Delivery Date: 2 days from today
4. Submit

✅ PASS if: Timeline shows 🔄 In Transit with ETA
❌ FAIL if: Error

---

### Test 9.4 — Mark as Delivered
Click "Add Update":
1. Event Type: "delivered"
2. Event Date: today + 2 days
3. Submit

✅ PASS if: Timeline shows ✅ Delivered, "Confirm GRN" button appears
❌ FAIL if: Button doesn't appear

---

### Test 9.5 — Confirm GRN (Based on Hagerstone GRN Format)
Click "Confirm GRN" on the card:

Section 1 — Header:
1. Challan/DC Number: "DC-2026-001"
2. Received Date: today

Section 2 — Item Confirmation:
Row 1 (LT Panel Complete, PO Qty: 2):
- Received Qty: 2 (leave as is)
- Rejected Qty: 0
- Condition: Good
- Invoice Qty Match: Yes
- Spec Match: Yes

Row 2 (Fire Hose Pipe, PO Qty: 25):
- Received Qty: 23 (simulate shortage of 2)
- Rejected Qty: 0
- Condition: Good
- Invoice Qty Match: No (qty mismatch)
- Spec Match: Yes

3. Verify: Short Qty auto-calculates as 2 for row 2
4. Verify: "⚠ Partial delivery detected" amber banner appears
5. Shortage Notes: "2 nos Fire Hose Pipe not delivered — balance expected in next delivery"

Section 3: All quality checks selected
Click "Confirm GRN"

✅ PASS if: Toast "GRN-2026-0001 confirmed", card shows "GRN confirmed"
✅ PASS if: PO status stays as dispatched (not delivered) since partial
❌ FAIL if: Error or GRN number not generated

---

## MODULE 10 — VENDOR REGISTRATION (Public)

### Test 10.1 — Submit Vendor Registration
Open http://localhost:5173/vendor/register (new tab, not logged in):
1. Fill Company Name: "New Fire Systems Pvt Ltd"
2. GSTIN: "07NEWFS0001A1Z0"
3. Contact Person: "Rajesh Kumar"
4. Email: "rajesh@newfiresystems.com"
5. Phone: "+91 9700000001"
6. City: "Delhi", State: "Delhi"
7. Check categories: Fire Fighting, MEP
8. Check regions: Delhi NCR, Pan India
9. Business Description: "Specialised in fire fighting systems and MEP works since 2010"
10. Check the declaration checkbox
11. Click "Submit Registration"

✅ PASS if: Success screen shows "Registration Submitted Successfully!" with reference
❌ FAIL if: Error or form doesn't submit

---

### Test 10.2 — Check Status
Click "Check Status" on the success screen OR go to:
http://localhost:5173/vendor/status?email=rajesh@newfiresystems.com

✅ PASS if: Shows "⏳ Under Review" with company details
❌ FAIL if: Error or blank page

---

### Test 10.3 — Review Registration (Procurement Head)
Back in the main app at /suppliers:
1. Look for "Pending Registrations" tab at the top
2. Should show "Pending Registrations (1)" with New Fire Systems

Click "Approve":
1. Confirmation dialog appears
2. Confirm approval

✅ PASS if: Toast "Vendor approved and added to supplier master"
✅ PASS if: Supplier count goes from 15 to 16 in All Suppliers tab
✅ PASS if: Going back to /vendor/status shows "✅ Approved"
❌ FAIL if: Error or count not updated

---

## MODULE 11 — AUDIT LOG

### Test 11.1 — View Audit Log
Go to /audit:
1. Should see log entries from all actions taken during testing
   (PR created, RFQ created, quotes logged, PO approved, GRN confirmed, etc.)
2. Columns: Timestamp, User, Action, Entity, Description, Severity

NOTE: Audit log entries are only created if the code explicitly inserts them.
If empty: this means the audit log insertion code was not implemented in the pages.
This is acceptable for Phase 1 — log the finding.

✅ PASS if: Log entries visible
⚠ NOTE if: Empty — means audit logging not wired in page actions

---

### Test 11.2 — Audit Log Filters
If entries exist:
1. Search for "PR" — should filter to PR-related actions
2. Filter by Action Type "APPROVE" — should show approval events
3. Filter by date range — should work

✅ PASS if: Filters work
❌ FAIL if: Filters have no effect

---

### Test 11.3 — Access Control
Test that non-auditor roles cannot see audit log.
(Since we only have one user, we'll skip this for now — note for multi-user testing)

---

## MODULE 12 — FINAL CHECKS

### Test 12.1 — Dashboard Updates After Testing
Go back to /dashboard:
1. Total PRs should show 2
2. Active POs should show the PO we created
3. Total Suppliers should show 16 (15 original + 1 approved registration)
4. Pipeline visual should show items at each stage

✅ PASS if: KPIs updated with real data
❌ FAIL if: Still showing 0s (data not refreshing)

---

### Test 12.2 — Sign Out and Back In
1. Click "Sign Out" in sidebar
2. Redirects to /login
3. Log back in with same credentials
4. Dashboard loads correctly

✅ PASS if: Session works correctly
❌ FAIL if: Error on sign out or login fails after

---

### Test 12.3 — Page Refresh Persistence
1. On /suppliers, press F5 (refresh)
2. Should stay on /suppliers (not redirect to login)
3. Data should reload

✅ PASS if: Stays on page, reloads data
❌ FAIL if: Kicked to login on refresh (auth not persisting)

---

## FINDINGS LOG — Fill this in as you test

Copy this table and fill in results:

| Test | Status | Issue Found |
|------|--------|-------------|
| 1.1 Login | | |
| 1.2 Dashboard KPIs | | |
| 1.3 Sidebar Navigation | | |
| 1.4 Public Vendor Register | | |
| 2.1 View Suppliers | | |
| 2.2 Search Suppliers | | |
| 2.3 Add Supplier | | |
| 3.1 View Items | | |
| 3.2 Category Filter | | |
| 3.3 Benchmark Indicator | | |
| 3.4 Edit Item | | |
| 4.1 PR Empty State | | |
| 4.2 Create PR | | |
| 4.3 View PR Detail | | |
| 4.4 PR as Document | | |
| 5.1 RFQ Empty State | | |
| 5.2 Create RFQ | | |
| 5.3 Anti-Corruption Block | | |
| 6.1 Log Quote | | |
| 6.2 Blind Quote System | | |
| 6.3 Log 4 More Quotes | | |
| 6.4 Review Quote | | |
| 6.5 Mark Reviewed | | |
| 7.1 Navigate to Comparison | | |
| 7.2 Generate Sheet | | |
| 7.3 Manual Review | | |
| 8.1 Create PO | | |
| 8.2 View PO Document | | |
| 8.3 Approve PO | | |
| 8.4 Send to Supplier | | |
| 9.1 View Delivery Tracker | | |
| 9.2 Add Dispatch Update | | |
| 9.3 In Transit Update | | |
| 9.4 Mark Delivered | | |
| 9.5 Confirm GRN | | |
| 10.1 Vendor Registration | | |
| 10.2 Check Status | | |
| 10.3 Review Registration | | |
| 11.1 Audit Log | | |
| 12.1 Dashboard Updates | | |
| 12.2 Sign Out | | |
| 12.3 Refresh Persistence | | |

---

## KNOWN ISSUES TO CHECK SPECIFICALLY

1. ComparisonSheet.tsx had duplicate code — verify it loads without errors at /comparison/:rfqId
2. DeliveryTracker.tsx had TypeScript errors — verify delivery cards render and GRN dialog opens
3. Audit log may be empty if audit log inserts were not wired into page actions
4. RFQ "Compare →" button may not appear if RFQ status is not updated to 'comparison_ready'
   Workaround: navigate directly to /comparison/[rfq-id]
5. Supplier names should NOT appear in /quotes table — verify blind system is working

---

## HOW TO REPORT ISSUES

For each failure, note:
1. Test number (e.g. "Test 7.2")
2. What you expected
3. What actually happened
4. Any error message in the browser console (press F12 → Console tab)

Send screenshots + the filled findings table to Claude for fixes.
