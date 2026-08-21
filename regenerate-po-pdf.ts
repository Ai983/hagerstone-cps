// One-off maintenance script: rebuild + re-upload a PO's PDF straight from its
// DB rows, using the same builder the app uses. Mirrors buildPoPdfFromDb in
// src/pages/PurchaseOrders.tsx (that copy lives inside a React page, so it
// cannot be imported here).
//
// Run: npx tsx regenerate-po-pdf.ts HI-PO-2026-0275
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { buildPoPdf, uploadPoPdf } from "./src/lib/generatePoPdf";

const URL = "https://tpfvnerrjhqwipyonngf.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwZnZuZXJyamhxd2lweW9ubmdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4Nzg3MjAsImV4cCI6MjA5MzQ1NDcyMH0.JFH5Z5mznhJKxNpecM1ebWutIltHzdoTgdDiSL4NM5c";

const poNumbers = process.argv.slice(2);
if (poNumbers.length === 0) {
  console.error("usage: npx tsx regenerate-po-pdf.ts <PO_NUMBER> [PO_NUMBER...]");
  process.exit(1);
}

const supabase = createClient(URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: "cps" },
});

const { error: authErr } = await supabase.auth.signInWithPassword({
  email: "admin@hagerstone.com",
  password: "Hagerstone@2026",
});
if (authErr) { console.error("login failed:", authErr.message); process.exit(1); }
console.log("logged in as admin@hagerstone.com");

const logoBase64 = readFileSync("./src/assets/optimisedlogo.png").toString("base64");

for (const poNumber of poNumbers) {
  const { data: po, error: poErr } = await supabase
    .from("cps_purchase_orders")
    .select("id,po_number,pr_id,supplier_id,created_at,created_by,ship_to_address,payment_terms,delivery_date,po_upto,valid_upto,insp_at,project_code,total_value,gst_amount,grand_total,advance_payments,advance_paid_total,bank_account_holder_name,bank_name,bank_ifsc,bank_account_number,hagerstone_gstin,version,revision_reason")
    .eq("po_number", poNumber)
    .maybeSingle();
  if (poErr || !po) { console.log(`  FAIL ${poNumber}: not found ${poErr?.message ?? ""}`); continue; }

  const poId = (po as any).id;
  const [supplierRes, prRes, linesRes, creatorRes, schedulesRes] = await Promise.all([
    (po as any).supplier_id
      ? supabase.from("cps_suppliers").select("name,gstin,state,address_text,phone,email").eq("id", (po as any).supplier_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    (po as any).pr_id
      ? supabase.from("cps_purchase_requisitions").select("pr_number,project_code,project_site").eq("id", (po as any).pr_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    supabase.from("cps_po_line_items").select("description,brand,quantity,unit,rate,gst_percent,gst_amount,total_value,hsn_code,sort_order,is_charge").eq("po_id", poId).order("sort_order"),
    (po as any).created_by
      ? supabase.from("cps_users").select("name,email").eq("id", (po as any).created_by).maybeSingle()
      : Promise.resolve({ data: null } as any),
    supabase.from("cps_po_payment_schedules").select("milestone_name,milestone_order,amount,percentage,basis,trigger_type,trigger_offset_days,due_trigger").eq("po_id", poId).order("milestone_order"),
  ]);

  const supplier: any = (supplierRes as any).data ?? {};
  const pr: any = (prRes as any).data ?? {};
  const lines: any[] = (linesRes as any).data ?? [];
  const creator: any = (creatorRes as any).data ?? {};
  const schedules: any[] = (schedulesRes as any).data ?? [];

  const blob = buildPoPdf({
    poNumber: (po as any).po_number,
    prNumber: pr.pr_number ?? null,
    poDate: (po as any).created_at,
    supplierName: supplier.name ?? "",
    supplierGstin: supplier.gstin ?? null,
    supplierState: supplier.state ?? null,
    supplierAddress: supplier.address_text ?? null,
    supplierPhone: supplier.phone ?? null,
    supplierEmail: supplier.email ?? null,
    shipToAddress: (po as any).ship_to_address ?? pr.project_site ?? null,
    inspAt: (po as any).insp_at ?? pr.project_site ?? null,
    paymentTerms: (po as any).payment_terms,
    deliveryDate: (po as any).delivery_date,
    poUpto: (po as any).po_upto ?? null,
    validUpto: (po as any).valid_upto ?? null,
    projectCode: (po as any).project_code ?? pr.project_code ?? null,
    projectName: pr.project_code ?? (po as any).project_code ?? null,
    subTotal: Number((po as any).total_value ?? 0),
    gstAmount: Number((po as any).gst_amount ?? 0),
    grandTotal: Number((po as any).grand_total ?? 0),
    logoBase64,
    hagerstoneGstin: (po as any).hagerstone_gstin ?? "09AAECH3768B1ZM",
    createdByName: creator.name ?? creator.email ?? null,
    bankAccountHolderName: (po as any).bank_account_holder_name,
    bankName: (po as any).bank_name,
    bankIfsc: (po as any).bank_ifsc,
    bankAccountNumber: (po as any).bank_account_number,
    advancePayments: Array.isArray((po as any).advance_payments) ? (po as any).advance_payments : [],
    advancePaidTotal: Number((po as any).advance_paid_total ?? 0),
    version: (po as any).version,
    revisionReason: (po as any).revision_reason,
    installments: schedules.map((s) => ({
      milestone_name: s.milestone_name ?? "",
      basis: s.basis ?? null,
      percentage: s.percentage != null ? Number(s.percentage) : null,
      amount: Number(s.amount ?? 0),
      trigger_type: s.trigger_type ?? s.due_trigger ?? null,
      trigger_offset_days: s.trigger_offset_days ?? null,
    })),
    lineItems: lines.map((li) => ({
      description: li.description ?? "",
      quantity: Number(li.quantity ?? 0),
      unit: li.unit,
      rate: Number(li.rate ?? 0),
      gst_percent: Number(li.gst_percent ?? 0),
      gst_amount: li.gst_amount,
      total_value: Number(li.total_value ?? 0),
      hsn_code: li.hsn_code,
      brand: li.brand,
      is_charge: (li as { is_charge?: boolean | null }).is_charge ?? false,
    })),
  });

  const url = await uploadPoPdf(supabase as any, poId, (po as any).po_number, blob);
  if (url) console.log(`  ok   ${poNumber}`);
  else console.log(`  FAIL ${poNumber} (upload returned null)`);
}
process.exit(0);
