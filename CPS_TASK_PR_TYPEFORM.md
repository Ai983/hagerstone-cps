# CPS TASK — PR Typeform Redesign + Quote Parsing Fix
# Date: 31 March 2026
# Priority: HIGH — Fix tonight

---

## READ FIRST
Read CLAUDE.md for context. This task has 3 parts:
1. Redesign PR form as Typeform-style multi-step wizard
2. Fix the project dropdown visibility bug
3. Ensure AI quote parsing handles real-world quote PDFs like the attached sample

---

## PART 1: TYPEFORM-STYLE PR FORM

### WHAT:
Replace the current PR creation dialog with a full-screen, Typeform-inspired multi-step wizard.
Each step shows ONE question at a time, with smooth transitions.

### DESIGN INSPIRATION (Typeform):
- Full-screen overlay, centered content
- One question per screen
- Large text, clean whitespace
- "Done ✓" button or Enter to proceed
- Progress indicator at top (step 1 of 5, etc.)
- Smooth slide/fade animation between steps
- Hagerstone brown/gold theme (NOT the blue/teal Typeform colors)

### IMPLEMENTATION:

Replace the current PR dialog with a new component. Keep it in PurchaseRequisitions.tsx or create a new PurchaseRequisitionWizard.tsx component.

**Step 1: Select Project**
```
"Which project is this for?" *

[Dropdown showing projects from cps_projects table]
- Dee Development Engineers LTD
- Dee Foundation  
- Hero Homes Realty
- Raneet Sufsa
- Max Hospital
- Other (type manually)

[Done ✓]  press Enter ↵
```

When a project is selected, store the project name AND auto-fill the site address from cps_projects.site_address.
Do NOT show "Project Code" field — remove it entirely.

**Step 2: Site Address (pre-filled)**
```
"Delivery location for this project"

[Textarea pre-filled with the selected project's site_address]
(User can edit if needed)

[Done ✓]  press Enter ↵
```

**Step 3: Required By Date**
```
"When do you need these materials?" *

[Date picker — large, touch-friendly]
(Default: 2 weeks from today)

[Done ✓]  press Enter ↵
```

**Step 4: Add Items (multi-item step)**
```
"What materials do you need?"

Item 1:
┌─────────────────────────────────────────┐
│ Search item master...          🔍       │
│ [Dropdown with search]                  │
│                                         │
│ Material: [auto-filled from master]     │
│ Quantity: [___]    Unit: [auto-filled]   │
│ Required for: [e.g. Floor 3 plumbing]   │
│ Preferred Brand: [optional]             │
└─────────────────────────────────────────┘

[+ Add another item]

⚠ If item not found: "Item not in database. Procurement team will be notified."
   Still allow manual entry with description + quantity + unit.

[Done ✓]
```

The item search should:
- Search cps_items by name (case-insensitive, fuzzy)
- Show category badge next to each result
- Show benchmark rate if exists (as "~₹XXX/unit")
- On select: auto-fill description, unit from the item record

**Step 5: Notes (optional)**
```
"Any special instructions?"

[Large textarea]
(Optional — skip with Enter)

[Submit PR]
```

**Step 6: Success Screen**
```
✅ PR Submitted Successfully!

PR Number: PR-2026-XXXX
Project: [name]
Items: [count] materials requested
RFQ will be auto-created and sent to suppliers.

[View My PRs]  [Raise Another PR]
```

### TECHNICAL DETAILS:

State management:
```typescript
const [step, setStep] = useState(1);
const totalSteps = 5;

// Animate transitions
const StepWrapper = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="w-full max-w-2xl px-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {children}
    </div>
  </div>
);
```

Progress bar:
```tsx
<div className="w-full bg-muted h-1 rounded-full">
  <div 
    className="bg-primary h-1 rounded-full transition-all duration-500"
    style={{ width: `${(step / totalSteps) * 100}%` }}
  />
</div>
```

Step counter:
```tsx
<span className="text-sm text-muted-foreground">
  {step} → of {totalSteps}
</span>
```

Enter key handling:
```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && canProceed) {
      e.preventDefault();
      nextStep();
    }
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [step, canProceed]);
```

### STYLING:
- Background: full screen with `bg-background`
- Question text: `text-2xl md:text-3xl font-light text-foreground`
- Step indicator: `text-primary font-mono`
- Done button: `bg-primary text-primary-foreground h-12 px-8 rounded-lg`
- Input fields: large, `h-14 text-lg border-b-2 border-primary/30 focus:border-primary`
- Use Hagerstone brown/gold theme — NOT hardcoded colors
- Mobile: single column, large touch targets (h-14 minimum)

### WHAT TO REMOVE:
- Remove "Project Code" field entirely — not needed
- Remove the old modal-style dialog for PR creation
- Keep the existing PR list view (table on desktop, cards on mobile) unchanged

### SUBMISSION LOGIC:
Same as current — call cps_next_pr_number(), insert PR, insert line items, 
call cps_auto_create_rfq_for_pr(), fire webhook. Just different UI wrapping it.

---

## PART 2: FIX PROJECT DROPDOWN

The current project dropdown has a bug — when you select a project, the value 
doesn't show in the field. This is because the Select component value binding 
is wrong.

Fix: When using shadcn Select for projects:
```tsx
<Select value={selectedProject} onValueChange={(val) => {
  setSelectedProject(val);
  // Find project and auto-fill site address
  const proj = projects.find(p => p.id === val);
  if (proj) {
    setProjectSite(proj.site_address || proj.name);
  }
}}>
  <SelectTrigger className="h-14 text-lg">
    <SelectValue placeholder="Select a project..." />
  </SelectTrigger>
  <SelectContent>
    {projects.map(p => (
      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
    ))}
    <SelectItem value="other">Other (type manually)</SelectItem>
  </SelectContent>
</Select>
```

Make sure:
- The value is the project UUID (not the name)
- SelectValue renders the project name correctly
- "Other" option shows a text input for manual entry

---

## PART 3: QUOTE AI PARSING — HANDLE REAL QUOTES

The sample quote (QUOTATION-BALAJI_INDUSTRIES.pdf) shows what real quotes look like:
- Professional header with company logo
- GSTIN prominently displayed  
- Structured table: S.No | Description | Make | Unit | Qty | Rate | Discount | Amount
- Terms & Conditions section at bottom
- Signature and stamp

The AI parsing prompt in Section 1 of CPS_MASTER_TASK.md already handles this.
But make sure:

1. The file preview panel can show PDFs in an iframe
2. The Claude API call uses `type: "document"` for PDFs (not `type: "image"`)
3. For the content array sent to Claude, PDFs should use:
```typescript
{
  type: "document",
  source: { 
    type: "url", 
    url: fileUrl,
    media_type: "application/pdf"  
  }
}
```
4. For images use:
```typescript
{
  type: "image",
  source: {
    type: "url",
    url: fileUrl,
    media_type: "image/jpeg"  // or image/png
  }
}
```

---

## DB INFO:
- cps_projects table exists with 5 projects (id, name, site_address, active)
- cps_items has 156 items now (3 new pump items added)
- 63 suppliers total (58 real + 5 test)
- PR submission: call cps_next_pr_number() first, pr_number is NOT NULL
- Audit log: uses `logged_at` NOT `created_at`
- All buttons: min h-11 on mobile
- NEVER hardcode colors, NEVER modify src/components/ui/

## VERIFY:
```bash
npx tsc --noEmit 2>&1 | grep -v "components/ui" | grep -v "supabase/client"
npx vite build
```
