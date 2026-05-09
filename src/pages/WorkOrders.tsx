import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import {
  Plus, Search, FileText, Trash2, Eye, ArrowLeft, ArrowRight,
  Save, CheckCircle2, X as XIcon, Briefcase,
} from "lucide-react";

import {
  buildWoPdf, uploadWoPdf, uploadWoRateList,
  WO_CATEGORIES, WO_DEFAULT_STANDARD_TERMS, WO_DEFAULT_WORK_REMARKS,
  type WoPdfData, type WoPdfLineItem, type WoPdfCustomColumn,
} from "@/lib/generateWoPdf";

import logoUrl from "@/assets/wo-logo.jpeg";
// xlsx ships without bundled TS types in this repo; runtime works (Vite resolves it).
// @ts-ignore
import * as XLSX from "xlsx";

// ─── types ──────────────────────────────────────────────────────────

type WoStatus = "draft" | "issued" | "in_progress" | "completed" | "closed" | "cancelled";

type WoRow = {
  id: string;
  wo_number: string;
  category: string;
  status: WoStatus;
  project_site: string | null;
  project_code: string | null;
  supplier_id: string | null;
  supplier_name_text: string | null;
  grand_total: number | null;
  created_at: string;
  wo_pdf_url: string | null;
};

type Supplier = {
  id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  address_text: string | null;
  state: string | null;
};

type LineItem = {
  // sentinel field — only used in UI
  _key: string;
  item: string;
  hsn_code: string;
  description: string;
  delivery_date: string;
  quantity: string;
  unit: string;
  rate: string;
  discount: string;
  total_value: string;
  sgst_percent: string;
  cgst_percent: string;
  igst_percent: string;
  custom_data: Record<string, string>;
};

const newLineItem = (): LineItem => ({
  _key: crypto.randomUUID(),
  item: "",
  hsn_code: "",
  description: "",
  delivery_date: "",
  quantity: "",
  unit: "",
  rate: "",
  discount: "",
  total_value: "",
  sgst_percent: "",
  cgst_percent: "",
  igst_percent: "",
  custom_data: {},
});

const STATUS_BADGE: Record<WoStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  issued: "bg-blue-100 text-blue-800",
  in_progress: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-100 text-slate-800",
  cancelled: "bg-red-100 text-red-800",
};

const fmtINR = (n: number | null | undefined) =>
  n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

// ─── component ──────────────────────────────────────────────────────

export default function WorkOrders() {
  const { user, canViewPrices } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<WoRow[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [projectSiteSuggestions, setProjectSiteSuggestions] = useState<string[]>([]);
  const [logoBase64, setLogoBase64] = useState<string | null>(null);

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardEditId, setWizardEditId] = useState<string | null>(null);
  const [wizardEditWoNumber, setWizardEditWoNumber] = useState<string | null>(null);

  // Step 0
  const [w_projectSite, setProjectSite] = useState("");
  const [w_projectCode, setProjectCode] = useState("");
  const [w_category, setCategory] = useState("");
  const [w_workAddress, setWorkAddress] = useState("");
  const [w_workAtName, setWorkAtName] = useState("");

  // Step 1 — vendor
  const [w_supplierId, setSupplierId] = useState<string>("");
  const [w_supplierName, setSupplierName] = useState("");
  const [w_supplierGstin, setSupplierGstin] = useState("");
  const [w_supplierState, setSupplierState] = useState("");
  const [w_supplierKindAttn, setSupplierKindAttn] = useState("");
  const [w_supplierContact, setSupplierContact] = useState("");
  const [w_supplierEmail, setSupplierEmail] = useState("");
  const [w_supplierAddress, setSupplierAddress] = useState("");
  const [w_isNewVendor, setIsNewVendor] = useState(false);
  const [w_rateListFile, setRateListFile] = useState<File | null>(null);
  const [parsingRateList, setParsingRateList] = useState(false);
  const [w_existingRateListUrl, setExistingRateListUrl] = useState<string | null>(null);
  const [w_existingRateListFilename, setExistingRateListFilename] = useState<string | null>(null);

  // Step 2 — full form
  const [w_priceBasis, setPriceBasis] = useState("");
  const [w_dispatchBy, setDispatchBy] = useState("Road");
  const [w_freightLabour, setFreightLabour] = useState("INCLUSIVE");
  const [w_insurance, setInsurance] = useState("SUPPLIER SCOPE");
  const [w_packingTerms, setPackingTerms] = useState("STANDARD");
  const [w_warranty, setWarranty] = useState("AS PER PI");
  const [w_testCertificate, setTestCertificate] = useState("REQUIRED");
  const [w_transporter, setTransporter] = useState("SUPPLIER SCOPE");
  const [w_deliverySchedule, setDeliverySchedule] = useState("");
  const [w_poIssueDate, setPoIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [w_poUptoDate, setPoUptoDate] = useState("");
  const [w_validUpto, setValidUpto] = useState("");
  const [w_effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [w_modeOfPayment, setModeOfPayment] = useState("NEFT/RTGS");
  const [w_paymentTerms, setPaymentTerms] = useState("");

  const [w_lineItems, setLineItems] = useState<LineItem[]>([newLineItem()]);
  const [w_customColumns, setCustomColumns] = useState<WoPdfCustomColumn[]>([]);
  const [w_standardTerms, setStandardTerms] = useState<string[]>([...WO_DEFAULT_STANDARD_TERMS]);
  const [w_workRemarks, setWorkRemarks] = useState<string[]>([...WO_DEFAULT_WORK_REMARKS]);

  const [w_preparedBy, setPreparedBy] = useState("");
  const [w_checkedBy, setCheckedBy] = useState("");
  const [w_authorisedSignatory, setAuthorisedSignatory] = useState("MR.DHRUV AGARWAL");

  // Step 3 — PDF preview
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Add column dialog
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [newColumnLabel, setNewColumnLabel] = useState("");

  // ── fetch list ──
  const fetchAll = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cps_work_orders")
        .select("id, wo_number, category, status, project_site, project_code, supplier_id, supplier_name_text, grand_total, created_at, wo_pdf_url")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRows((data ?? []) as WoRow[]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load work orders");
    } finally {
      setLoading(false);
    }
  };

  const fetchSuppliers = async () => {
    const { data } = await supabase
      .from("cps_suppliers")
      .select("id, name, gstin, phone, email, address_text, state")
      .order("name", { ascending: true })
      .limit(2000);
    setSuppliers((data ?? []) as Supplier[]);
  };

  const fetchProjectSites = async () => {
    const { data } = await supabase
      .from("cps_purchase_requisitions")
      .select("project_site, project_code")
      .order("created_at", { ascending: false })
      .limit(500);
    const set = new Set<string>();
    (data ?? []).forEach((p: any) => {
      if (p.project_site) set.add(p.project_site);
      if (p.project_code) set.add(p.project_code);
    });
    setProjectSiteSuggestions(Array.from(set));
  };

  useEffect(() => {
    fetchAll();
    fetchSuppliers();
    fetchProjectSites();
    // Load Hagerstone logo once into base64 for embedding in WO PDFs (same approach as PO PDFs)
    (async () => {
      try {
        const resp = await fetch(logoUrl);
        const blob = await resp.blob();
        const b64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1] ?? result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        setLogoBase64(b64);
      } catch { /* logo is optional — PDF renders without it */ }
    })();
  }, []);

  // ── derived ──
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        r.wo_number.toLowerCase().includes(q) ||
        (r.supplier_name_text ?? "").toLowerCase().includes(q) ||
        (r.project_site ?? "").toLowerCase().includes(q) ||
        (r.project_code ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, categoryFilter]);

  const stats = useMemo(() => {
    const draft = rows.filter((r) => r.status === "draft").length;
    const issued = rows.filter((r) => r.status === "issued" || r.status === "in_progress").length;
    const completed = rows.filter((r) => r.status === "completed" || r.status === "closed").length;
    const totalValue = rows
      .filter((r) => r.status !== "cancelled")
      .reduce((s, r) => s + (Number(r.grand_total) || 0), 0);
    return { draft, issued, completed, totalValue };
  }, [rows]);

  // ── computed totals during editing ──
  const computedTotals = useMemo(() => {
    let subtotal = 0;
    let gstAmount = 0;
    for (const li of w_lineItems) {
      const qty = parseFloat(li.quantity) || 0;
      const rate = parseFloat(li.rate) || 0;
      const disc = parseFloat(li.discount) || 0;
      const lineTotal = parseFloat(li.total_value) || (qty * rate - disc);
      subtotal += lineTotal;
      const sgst = (parseFloat(li.sgst_percent) || 0) / 100;
      const cgst = (parseFloat(li.cgst_percent) || 0) / 100;
      const igst = (parseFloat(li.igst_percent) || 0) / 100;
      gstAmount += lineTotal * (sgst + cgst + igst);
    }
    return { subtotal, gstAmount, grandTotal: subtotal + gstAmount };
  }, [w_lineItems]);

  // ── wizard helpers ──
  const resetWizard = () => {
    setWizardStep(0);
    setWizardEditId(null);
    setWizardEditWoNumber(null);
    setProjectSite(""); setProjectCode(""); setCategory(""); setWorkAddress(""); setWorkAtName("");
    setSupplierId(""); setSupplierName(""); setSupplierGstin(""); setSupplierState("");
    setSupplierKindAttn(""); setSupplierContact(""); setSupplierEmail(""); setSupplierAddress("");
    setIsNewVendor(false); setRateListFile(null);
    setExistingRateListUrl(null); setExistingRateListFilename(null);
    setPriceBasis(""); setDispatchBy("Road"); setFreightLabour("INCLUSIVE");
    setInsurance("SUPPLIER SCOPE"); setPackingTerms("STANDARD"); setWarranty("AS PER PI");
    setTestCertificate("REQUIRED"); setTransporter("SUPPLIER SCOPE"); setDeliverySchedule("");
    setPoIssueDate(new Date().toISOString().slice(0, 10));
    setPoUptoDate(""); setValidUpto(""); setEffectiveDate(new Date().toISOString().slice(0, 10));
    setModeOfPayment("NEFT/RTGS"); setPaymentTerms("");
    setLineItems([newLineItem()]);
    setCustomColumns([]);
    setStandardTerms([...WO_DEFAULT_STANDARD_TERMS]);
    setWorkRemarks([...WO_DEFAULT_WORK_REMARKS]);
    setPreparedBy(user?.name ?? "");
    setCheckedBy("");
    setAuthorisedSignatory("MR.DHRUV AGARWAL");
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    setPdfBlobUrl(null);
  };

  const openCreate = () => {
    resetWizard();
    setPreparedBy(user?.name ?? "");
    setWizardOpen(true);
  };

  const openEdit = async (row: WoRow) => {
    resetWizard();
    setWizardEditId(row.id);
    setLoading(true);
    try {
      const { data: wo } = await supabase
        .from("cps_work_orders")
        .select("*")
        .eq("id", row.id)
        .maybeSingle();
      if (!wo) throw new Error("Work order not found");
      setWizardEditWoNumber((wo as any).wo_number ?? null);
      const { data: items } = await supabase
        .from("cps_wo_line_items")
        .select("*")
        .eq("wo_id", row.id)
        .order("sort_order", { ascending: true });

      // hydrate state
      setProjectSite((wo as any).project_site ?? "");
      setProjectCode((wo as any).project_code ?? "");
      setCategory((wo as any).category);
      setWorkAddress((wo as any).work_address ?? "");
      // workAtName not stored separately — we'll just leave it empty when editing
      setSupplierId((wo as any).supplier_id ?? "");
      setSupplierName((wo as any).supplier_name_text ?? "");
      setSupplierGstin((wo as any).supplier_gstin ?? "");
      setSupplierState((wo as any).supplier_state ?? "");
      setSupplierKindAttn((wo as any).supplier_kind_attn ?? "");
      setSupplierContact((wo as any).supplier_contact ?? "");
      setSupplierEmail((wo as any).supplier_email ?? "");
      setSupplierAddress((wo as any).supplier_address ?? "");
      setExistingRateListUrl((wo as any).vendor_rate_list_url ?? null);
      setExistingRateListFilename((wo as any).vendor_rate_list_filename ?? null);
      setPriceBasis((wo as any).price_basis ?? "");
      setDispatchBy((wo as any).dispatch_by ?? "Road");
      setFreightLabour((wo as any).freight_labour ?? "INCLUSIVE");
      setInsurance((wo as any).insurance ?? "SUPPLIER SCOPE");
      setPackingTerms((wo as any).packing_terms ?? "STANDARD");
      setWarranty((wo as any).warranty ?? "AS PER PI");
      setTestCertificate((wo as any).test_certificate ?? "REQUIRED");
      setTransporter((wo as any).transporter ?? "SUPPLIER SCOPE");
      setDeliverySchedule((wo as any).delivery_schedule ?? "");
      setPoIssueDate((wo as any).po_issue_date ?? "");
      setPoUptoDate((wo as any).po_upto_date ?? "");
      setValidUpto((wo as any).valid_upto ?? "");
      setEffectiveDate((wo as any).effective_date ?? "");
      setModeOfPayment((wo as any).mode_of_payment ?? "NEFT/RTGS");
      setPaymentTerms((wo as any).payment_terms ?? "");
      setStandardTerms(((wo as any).standard_terms as string[]) ?? [...WO_DEFAULT_STANDARD_TERMS]);
      setWorkRemarks(((wo as any).work_remarks as string[]) ?? [...WO_DEFAULT_WORK_REMARKS]);
      setCustomColumns(((wo as any).custom_columns as WoPdfCustomColumn[]) ?? []);
      setPreparedBy((wo as any).prepared_by_name ?? "");
      setCheckedBy((wo as any).checked_by_name ?? "");
      setAuthorisedSignatory((wo as any).authorised_signatory ?? "MR.DHRUV AGARWAL");
      setLineItems(
        ((items ?? []) as any[]).map((it) => ({
          _key: crypto.randomUUID(),
          item: it.item ?? "",
          hsn_code: it.hsn_code ?? "",
          description: it.description ?? "",
          delivery_date: it.delivery_date ?? "",
          quantity: it.quantity != null ? String(it.quantity) : "",
          unit: it.unit ?? "",
          rate: it.rate != null ? String(it.rate) : "",
          discount: it.discount != null ? String(it.discount) : "",
          total_value: it.total_value != null ? String(it.total_value) : "",
          sgst_percent: it.sgst_percent != null ? String(it.sgst_percent) : "",
          cgst_percent: it.cgst_percent != null ? String(it.cgst_percent) : "",
          igst_percent: it.igst_percent != null ? String(it.igst_percent) : "",
          custom_data: (it.custom_data as Record<string, string>) ?? {},
        }))
      );
      setWizardStep(2); // edit jumps straight to the form
      setWizardOpen(true);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load work order");
    } finally {
      setLoading(false);
    }
  };

  const onSelectExistingSupplier = (id: string) => {
    setSupplierId(id);
    const s = suppliers.find((x) => x.id === id);
    if (s) {
      setSupplierName(s.name);
      setSupplierGstin(s.gstin ?? "");
      setSupplierState(s.state ?? "");
      setSupplierContact(s.phone ?? "");
      setSupplierEmail(s.email ?? "");
      setSupplierAddress(s.address_text ?? "");
    }
    setIsNewVendor(false);
  };

  const startNewVendor = () => {
    setIsNewVendor(true);
    setSupplierId("");
    setSupplierName(""); setSupplierGstin(""); setSupplierState("");
    setSupplierKindAttn(""); setSupplierContact(""); setSupplierEmail(""); setSupplierAddress("");
  };

  // Read a File into a base64 string (without the data: prefix) for sending to claude-proxy.
  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] ?? result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // Convert an uploaded Excel file (.xlsx / .xls) into a plain-text CSV-like dump
  // of every sheet. This is what we send to Claude when the rate list is a spreadsheet
  // (Anthropic doesn't accept Excel directly as a document/image content block).
  const excelToText = async (file: File): Promise<string> => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const out: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      if (csv.trim()) {
        out.push(`=== Sheet: ${sheetName} ===\n${csv}`);
      }
    }
    return out.join("\n\n");
  };

  // Send the uploaded vendor rate list (PDF / image / Excel) to Claude and get back
  // structured line items, then pre-populate the line items table. User can still edit.
  const parseRateListWithAi = async () => {
    if (!w_rateListFile) {
      toast.error("Pehle rate list file upload karo");
      return;
    }
    setParsingRateList(true);
    try {
      const file = w_rateListFile;
      const mediaType = file.type;
      const filename = file.name.toLowerCase();
      const isExcel =
        /\.(xlsx|xls|xlsm|xlsb|csv)$/i.test(filename) ||
        mediaType === "application/vnd.ms-excel" ||
        mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        mediaType === "text/csv";

      let contentBlock: any;
      if (isExcel) {
        // Convert Excel to plain CSV text and send as a text block.
        const sheetText = await excelToText(file);
        if (!sheetText.trim()) {
          toast.error("Excel file empty hai ya read nahi ho payi");
          setParsingRateList(false);
          return;
        }
        contentBlock = {
          type: "text",
          text: `Below is the contents of an Excel rate list (each sheet shown as CSV):\n\n${sheetText}`,
        };
      } else if (mediaType === "application/pdf") {
        const base64 = await fileToBase64(file);
        contentBlock = { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } };
      } else if (/^image\/(jpeg|png|webp)$/.test(mediaType)) {
        const base64 = await fileToBase64(file);
        contentBlock = { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
      } else {
        toast.error("Supported types: PDF, JPG, PNG, WebP, Excel (xlsx/xls), CSV");
        setParsingRateList(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("claude-proxy", {
        body: {
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          messages: [
            {
              role: "user",
              content: [
                contentBlock,
                {
                  type: "text",
                  text: `Extract every line item from this contractor / vendor rate list document.

Return ONLY a valid JSON object (no markdown, no commentary) with this shape:
{
  "items": [
    {
      "item": "short item code or short name (e.g. 'Gypsum Partition' or SKU code)",
      "hsn_code": "HSN/SAC code if visible, else empty string",
      "description": "full description of the work or material as written",
      "quantity": number (use 1 if not specified),
      "unit": "unit (SQFT, RFT, NOS, etc.); empty if not specified",
      "rate": number (per-unit rate, plain number — no currency symbols, no commas),
      "discount": number (use 0 if no discount),
      "total_value": number (line total = quantity * rate - discount; compute if missing),
      "sgst_percent": number (use 0 if not specified),
      "cgst_percent": number (use 0 if not specified),
      "igst_percent": number (use 0 if not specified — common values are 5, 12, 18)
    }
  ]
}

Rules:
- Every numeric field MUST be a plain number (not a string). If unknown, use 0 (NOT null).
- "items" must be an array; if you find no items, return an empty array.
- Do not invent data. Only extract what's actually visible in the document.`,
                },
              ],
            },
          ],
        },
      });

      if (error) throw error;

      // claude-proxy returns the Anthropic message envelope; find the text block and parse JSON
      const textBlock = (data?.content ?? []).find((b: any) => b.type === "text");
      const raw = textBlock?.text ?? "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("AI response me JSON nahi mila");
      const parsed = JSON.parse(jsonMatch[0]) as { items?: any[] };
      const aiItems = Array.isArray(parsed.items) ? parsed.items : [];

      if (aiItems.length === 0) {
        toast.error("AI ko koi line items nahi mile — manually fill karo");
        return;
      }

      // Map AI items to LineItem state
      const newRows: LineItem[] = aiItems.map((it) => ({
        _key: crypto.randomUUID(),
        item: String(it.item ?? "").trim(),
        hsn_code: String(it.hsn_code ?? "").trim(),
        description: String(it.description ?? "").trim(),
        delivery_date: "",
        quantity: it.quantity != null ? String(it.quantity) : "",
        unit: String(it.unit ?? "").trim(),
        rate: it.rate != null ? String(it.rate) : "",
        discount: it.discount != null ? String(it.discount) : "",
        total_value: it.total_value != null ? String(it.total_value) : "",
        sgst_percent: it.sgst_percent != null ? String(it.sgst_percent) : "",
        cgst_percent: it.cgst_percent != null ? String(it.cgst_percent) : "",
        igst_percent: it.igst_percent != null ? String(it.igst_percent) : "",
        custom_data: {},
      }));
      setLineItems(newRows);
      toast.success(`${newRows.length} items extract ho gaye — step 3 me jaake edit karo`);
    } catch (e: any) {
      toast.error("AI parse fail: " + (e?.message || "Unknown"));
    } finally {
      setParsingRateList(false);
    }
  };

  const updateLineItem = (key: string, patch: Partial<LineItem>) => {
    setLineItems((prev) =>
      prev.map((li) => {
        if (li._key !== key) return li;
        const next = { ...li, ...patch };
        // auto-compute total_value if user updated qty/rate/discount and didn't override total
        if (
          (patch.quantity !== undefined || patch.rate !== undefined || patch.discount !== undefined) &&
          patch.total_value === undefined
        ) {
          const qty = parseFloat(next.quantity) || 0;
          const rate = parseFloat(next.rate) || 0;
          const disc = parseFloat(next.discount) || 0;
          next.total_value = (qty * rate - disc).toFixed(2);
        }
        return next;
      })
    );
  };

  const setCustomCellValue = (key: string, colKey: string, val: string) => {
    setLineItems((prev) =>
      prev.map((li) =>
        li._key === key ? { ...li, custom_data: { ...li.custom_data, [colKey]: val } } : li
      )
    );
  };

  const addCustomColumn = () => {
    const label = newColumnLabel.trim();
    if (!label) { toast.error("Column name cannot be empty"); return; }
    if (label.length > 30) { toast.error("Column name must be 30 characters or fewer"); return; }
    if (w_customColumns.some((c) => c.label.toLowerCase() === label.toLowerCase())) {
      toast.error("A column with that name already exists"); return;
    }
    const colKey = "col_" + label.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "_" + Date.now().toString(36).slice(-4);
    setCustomColumns((prev) => [...prev, { key: colKey, label, type: "text" }]);
    setNewColumnLabel("");
    setAddColumnOpen(false);
  };

  const removeCustomColumn = (colKey: string) => {
    setCustomColumns((prev) => prev.filter((c) => c.key !== colKey));
    setLineItems((prev) =>
      prev.map((li) => {
        const { [colKey]: _drop, ...rest } = li.custom_data;
        return { ...li, custom_data: rest };
      })
    );
  };

  // ── PDF preview ──
  const renderPdfPreview = () => {
    const pdfData: WoPdfData = {
      woNumber: wizardEditWoNumber
        ?? (wizardEditId ? rows.find((r) => r.id === wizardEditId)?.wo_number : null)
        ?? `HSIPL/${w_category || "MISC"}/preview`,
      category: w_category,
      supplierName: w_supplierName,
      supplierGstin: w_supplierGstin,
      supplierState: w_supplierState,
      supplierKindAttn: w_supplierKindAttn,
      supplierContact: w_supplierContact,
      supplierEmail: w_supplierEmail,
      supplierAddress: w_supplierAddress,
      workAtName: w_workAtName || w_projectSite,
      workAddress: w_workAddress,
      priceBasis: w_priceBasis,
      dispatchBy: w_dispatchBy,
      freightLabour: w_freightLabour,
      insurance: w_insurance,
      packingTerms: w_packingTerms,
      warranty: w_warranty,
      testCertificate: w_testCertificate,
      transporter: w_transporter,
      deliverySchedule: w_deliverySchedule || null,
      poIssueDate: w_poIssueDate || null,
      poUptoDate: w_poUptoDate || null,
      validUpto: w_validUpto || null,
      effectiveDate: w_effectiveDate || null,
      modeOfPayment: w_modeOfPayment,
      paymentTerms: w_paymentTerms,
      subtotal: computedTotals.subtotal,
      gstAmount: computedTotals.gstAmount,
      grandTotal: computedTotals.grandTotal,
      customColumns: w_customColumns,
      standardTerms: w_standardTerms,
      workRemarks: w_workRemarks,
      preparedByName: w_preparedBy,
      checkedByName: w_checkedBy,
      authorisedSignatory: w_authorisedSignatory,
      logoBase64,
      lineItems: w_lineItems
        .filter((li) => li.description.trim())
        .map<WoPdfLineItem>((li) => ({
          item: li.item,
          hsn_code: li.hsn_code,
          description: li.description,
          delivery_date: li.delivery_date || null,
          quantity: parseFloat(li.quantity) || 0,
          unit: li.unit,
          rate: parseFloat(li.rate) || 0,
          discount: parseFloat(li.discount) || 0,
          total_value: parseFloat(li.total_value) || (parseFloat(li.quantity) || 0) * (parseFloat(li.rate) || 0),
          sgst_percent: parseFloat(li.sgst_percent) || 0,
          cgst_percent: parseFloat(li.cgst_percent) || 0,
          igst_percent: parseFloat(li.igst_percent) || 0,
          custom_data: li.custom_data,
        })),
    };
    const blob = buildWoPdf(pdfData);
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    setPdfBlobUrl(URL.createObjectURL(blob));
  };

  // ── save / finalise ──
  const persistWorkOrder = async (finalise: boolean): Promise<{ id: string; wo_number: string } | null> => {
    if (!user) { toast.error("Please log in"); return null; }
    if (!w_category) { toast.error("Category is required"); return null; }
    if (!w_supplierName.trim()) { toast.error("Vendor name is required"); return null; }
    if (w_lineItems.filter((li) => li.description.trim()).length === 0) {
      toast.error("Add at least one line item"); return null;
    }
    setSaving(true);
    try {
      let woId = wizardEditId;
      let woNumber = "";

      if (!woId) {
        // Mint new WO number
        const { data: numData, error: numErr } = await supabase.rpc("cps_next_wo_number", { p_category: w_category });
        if (numErr || !numData) throw new Error(numErr?.message || "Failed to generate WO number");
        woNumber = String(numData);
      } else {
        // Prefer state captured during openEdit; fall back to rows lookup if absent
        woNumber = wizardEditWoNumber ?? rows.find((x) => x.id === woId)?.wo_number ?? "";
      }

      // Resolve supplier — if new, insert into cps_suppliers
      let supplierId: string | null = w_supplierId || null;
      if (w_isNewVendor && w_supplierName.trim()) {
        const { data: insSup, error: supErr } = await supabase
          .from("cps_suppliers")
          .insert({
            name: w_supplierName.trim(),
            gstin: w_supplierGstin || null,
            phone: w_supplierContact || null,
            email: w_supplierEmail || null,
            address_text: w_supplierAddress || null,
            state: w_supplierState || null,
            status: "active",
          } as any)
          .select("id")
          .single();
        if (supErr) throw supErr;
        supplierId = insSup?.id ?? null;
      }

      const status: WoStatus = finalise ? "issued" : "draft";

      const woPayload: any = {
        wo_number: woNumber,
        category: w_category,
        status,
        project_site: w_projectSite || null,
        project_code: w_projectCode || null,
        work_address: [w_workAtName, w_workAddress].filter(Boolean).join("\n") || null,
        supplier_id: supplierId,
        supplier_name_text: w_supplierName,
        supplier_gstin: w_supplierGstin || null,
        supplier_state: w_supplierState || null,
        supplier_kind_attn: w_supplierKindAttn || null,
        supplier_contact: w_supplierContact || null,
        supplier_email: w_supplierEmail || null,
        supplier_address: w_supplierAddress || null,
        price_basis: w_priceBasis || null,
        dispatch_by: w_dispatchBy || null,
        freight_labour: w_freightLabour || null,
        insurance: w_insurance || null,
        packing_terms: w_packingTerms || null,
        warranty: w_warranty || null,
        test_certificate: w_testCertificate || null,
        transporter: w_transporter || null,
        delivery_schedule: w_deliverySchedule || null,
        po_issue_date: w_poIssueDate || null,
        po_upto_date: w_poUptoDate || null,
        valid_upto: w_validUpto || null,
        effective_date: w_effectiveDate || null,
        mode_of_payment: w_modeOfPayment || null,
        payment_terms: w_paymentTerms || null,
        subtotal: computedTotals.subtotal,
        gst_amount: computedTotals.gstAmount,
        grand_total: computedTotals.grandTotal,
        custom_columns: w_customColumns,
        standard_terms: w_standardTerms,
        work_remarks: w_workRemarks,
        prepared_by_name: w_preparedBy || null,
        checked_by_name: w_checkedBy || null,
        authorised_signatory: w_authorisedSignatory || null,
      };

      if (woId) {
        const { error: updErr } = await supabase.from("cps_work_orders").update(woPayload).eq("id", woId);
        if (updErr) throw updErr;
      } else {
        woPayload.created_by = user.id;
        if (finalise) { woPayload.finalised_at = new Date().toISOString(); woPayload.finalised_by = user.id; }
        const { data: ins, error: insErr } = await supabase
          .from("cps_work_orders")
          .insert(woPayload as any)
          .select("id")
          .single();
        if (insErr) throw insErr;
        woId = ins.id;
      }

      if (!woId) throw new Error("Failed to obtain WO id");

      // Replace line items (simpler than diffing for v1)
      await supabase.from("cps_wo_line_items").delete().eq("wo_id", woId);
      const liRows = w_lineItems
        .filter((li) => li.description.trim())
        .map((li, idx) => ({
          wo_id: woId,
          sort_order: idx,
          item: li.item || null,
          hsn_code: li.hsn_code || null,
          description: li.description,
          delivery_date: li.delivery_date || null,
          quantity: parseFloat(li.quantity) || null,
          unit: li.unit || null,
          rate: parseFloat(li.rate) || null,
          discount: parseFloat(li.discount) || 0,
          total_value: parseFloat(li.total_value) || null,
          sgst_percent: parseFloat(li.sgst_percent) || 0,
          cgst_percent: parseFloat(li.cgst_percent) || 0,
          igst_percent: parseFloat(li.igst_percent) || 0,
          custom_data: li.custom_data,
        }));
      if (liRows.length > 0) {
        const { error: liErr } = await supabase.from("cps_wo_line_items").insert(liRows as any);
        if (liErr) throw liErr;
      }

      // Rate list handling:
      //  - if a new file was selected, upload it and overwrite the DB URL
      //  - else if user cleared the existing URL via the X button, null it out
      if (w_rateListFile) {
        const { url, filename } = await uploadWoRateList(supabase, woId, w_rateListFile);
        if (url) {
          await supabase
            .from("cps_work_orders")
            .update({ vendor_rate_list_url: url, vendor_rate_list_filename: filename })
            .eq("id", woId);
        }
      } else if (wizardEditId && !w_existingRateListUrl) {
        await supabase
          .from("cps_work_orders")
          .update({ vendor_rate_list_url: null, vendor_rate_list_filename: null })
          .eq("id", woId);
      }

      // Generate + upload PDF
      const pdfData = await buildWoPdfFromState(woNumber);
      const pdfBlob = buildWoPdf(pdfData);
      await uploadWoPdf(supabase, woId, woNumber, pdfBlob);

      // Audit log
      try {
        await supabase.from("cps_audit_log").insert({
          user_id: user.id,
          user_name: user.name,
          user_role: user.role,
          action_type: wizardEditId ? "WO_EDITED" : (finalise ? "WO_FINALISED" : "WO_CREATED"),
          entity_type: "cps_work_orders",
          entity_id: woId,
          entity_number: woNumber,
          description: `Work order ${woNumber} ${wizardEditId ? "edited" : (finalise ? "finalised" : "created (draft)")}`,
          severity: "info",
          logged_at: new Date().toISOString(),
        } as any);
      } catch (_) {/* audit best-effort */}

      toast.success(`${woNumber} ${finalise ? "finalised" : "saved"}`);
      return { id: woId, wo_number: woNumber };
    } catch (e: any) {
      toast.error(e?.message || "Failed to save work order");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const buildWoPdfFromState = async (woNumber: string): Promise<WoPdfData> => ({
    woNumber,
    category: w_category,
    supplierName: w_supplierName,
    supplierGstin: w_supplierGstin,
    supplierState: w_supplierState,
    supplierKindAttn: w_supplierKindAttn,
    supplierContact: w_supplierContact,
    supplierEmail: w_supplierEmail,
    supplierAddress: w_supplierAddress,
    workAtName: w_workAtName || w_projectSite,
    workAddress: w_workAddress,
    priceBasis: w_priceBasis,
    dispatchBy: w_dispatchBy,
    freightLabour: w_freightLabour,
    insurance: w_insurance,
    packingTerms: w_packingTerms,
    warranty: w_warranty,
    testCertificate: w_testCertificate,
    transporter: w_transporter,
    deliverySchedule: w_deliverySchedule || null,
    poIssueDate: w_poIssueDate || null,
    poUptoDate: w_poUptoDate || null,
    validUpto: w_validUpto || null,
    effectiveDate: w_effectiveDate || null,
    modeOfPayment: w_modeOfPayment,
    paymentTerms: w_paymentTerms,
    subtotal: computedTotals.subtotal,
    gstAmount: computedTotals.gstAmount,
    grandTotal: computedTotals.grandTotal,
    customColumns: w_customColumns,
    standardTerms: w_standardTerms,
    workRemarks: w_workRemarks,
    preparedByName: w_preparedBy,
    checkedByName: w_checkedBy,
    authorisedSignatory: w_authorisedSignatory,
    logoBase64,
    lineItems: w_lineItems
      .filter((li) => li.description.trim())
      .map<WoPdfLineItem>((li) => ({
        hsn_code: li.hsn_code,
        description: li.description,
        delivery_date: li.delivery_date || null,
        quantity: parseFloat(li.quantity) || 0,
        unit: li.unit,
        rate: parseFloat(li.rate) || 0,
        discount: parseFloat(li.discount) || 0,
        total_value: parseFloat(li.total_value) || (parseFloat(li.quantity) || 0) * (parseFloat(li.rate) || 0),
        sgst_percent: parseFloat(li.sgst_percent) || 0,
        cgst_percent: parseFloat(li.cgst_percent) || 0,
        igst_percent: parseFloat(li.igst_percent) || 0,
        custom_data: li.custom_data,
      })),
  });

  const finaliseWO = async () => {
    const result = await persistWorkOrder(true);
    if (result) {
      setWizardOpen(false);
      resetWizard();
      fetchAll();
    }
  };

  const saveDraft = async () => {
    const result = await persistWorkOrder(false);
    if (result) {
      setWizardOpen(false);
      resetWizard();
      fetchAll();
    }
  };

  // ─── render ────────────────────────────────────────────────────

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 lg:gap-4 flex-wrap">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground flex items-center gap-2">
            <Briefcase className="h-5 w-5 lg:h-6 lg:w-6 text-primary" />
            Work Orders
          </h1>
          <p className="text-muted-foreground text-xs lg:text-sm mt-1">
            Contractor work orders for labour & installation services
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Create Work Order
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 lg:gap-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs lg:text-sm font-medium text-muted-foreground">Drafts</CardTitle></CardHeader><CardContent><div className="text-xl lg:text-2xl font-bold">{loading ? "—" : stats.draft}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs lg:text-sm font-medium text-muted-foreground">Active / Issued</CardTitle></CardHeader><CardContent><div className="text-xl lg:text-2xl font-bold">{loading ? "—" : stats.issued}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs lg:text-sm font-medium text-muted-foreground">Completed</CardTitle></CardHeader><CardContent><div className="text-xl lg:text-2xl font-bold">{loading ? "—" : stats.completed}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs lg:text-sm font-medium text-muted-foreground">Total Value</CardTitle></CardHeader><CardContent><div className="text-xl lg:text-2xl font-bold">{loading ? "—" : (canViewPrices ? fmtINR(stats.totalValue) : "***")}</div></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 lg:gap-3">
        <div className="relative flex-1 sm:min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search WO, vendor, site..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {WO_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden space-y-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
        ) : filteredRows.length === 0 ? (
          <Card><CardContent className="py-12 text-center space-y-2">
            <Briefcase className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <div className="text-sm text-muted-foreground">No work orders yet</div>
            <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" /> Create First WO</Button>
          </CardContent></Card>
        ) : (
          filteredRows.map((r) => (
            <Card key={r.id} className="cursor-pointer active:bg-muted/40" onClick={() => openEdit(r)}>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-primary text-xs font-semibold truncate">{r.wo_number}</span>
                  <Badge className={`text-[10px] border-0 ${STATUS_BADGE[r.status]}`}>{r.status.replace(/_/g, " ")}</Badge>
                </div>
                <div className="text-sm font-medium truncate">{r.supplier_name_text ?? "—"}</div>
                <div className="text-xs text-muted-foreground truncate">{r.project_site ?? "—"}</div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <Badge variant="outline" className="text-[10px]">{r.category}</Badge>
                  <span className="font-medium">{canViewPrices ? fmtINR(r.grand_total) : "***"}</span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Desktop table */}
      <Card className="hidden lg:block">
        <CardHeader><CardTitle className="text-base font-semibold">Work Order List</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>WO Number</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>)}
                  </TableRow>
                ))
              ) : filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12">
                    <div className="space-y-3">
                      <Briefcase className="h-10 w-10 mx-auto text-muted-foreground/30" />
                      <div className="text-muted-foreground">No work orders yet</div>
                      <Button onClick={openCreate} size="sm"><Plus className="h-4 w-4 mr-1.5" /> Create First WO</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => openEdit(r)}>
                    <TableCell className="font-mono text-primary font-semibold text-xs">{r.wo_number}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{r.category}</Badge></TableCell>
                    <TableCell className="text-sm">{r.supplier_name_text ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.project_site ?? "—"}</TableCell>
                    <TableCell><Badge className={`text-[10px] border-0 ${STATUS_BADGE[r.status]}`}>{r.status.replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell className="text-right text-sm font-medium">{canViewPrices ? fmtINR(r.grand_total) : "***"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.created_at)}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {r.wo_pdf_url && (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={r.wo_pdf_url} target="_blank" rel="noopener noreferrer" title="View PDF">
                              <Eye className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => openEdit(r)}>Edit</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Wizard Dialog */}
      <Dialog open={wizardOpen} onOpenChange={(o) => { if (!o) { setWizardOpen(false); resetWizard(); } }}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-5xl max-h-[92vh] overflow-y-auto p-0">
          <DialogHeader className="px-4 lg:px-6 pt-4 lg:pt-6 pb-3 border-b sticky top-0 bg-background z-10">
            <DialogTitle>
              {wizardEditId ? "Edit Work Order" : "Create Work Order"} — Step {wizardStep + 1} of 4
            </DialogTitle>
            <DialogDescription>
              {wizardStep === 0 && "Site & category"}
              {wizardStep === 1 && "Vendor (contractor) details"}
              {wizardStep === 2 && "Work order form"}
              {wizardStep === 3 && "Preview PDF & finalise"}
            </DialogDescription>
          </DialogHeader>

          {/* STEP 0 */}
          {wizardStep === 0 && (
            <div className="px-4 lg:px-6 py-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Project Site *</Label>
                  <Input
                    list="wo-project-sites"
                    value={w_projectSite}
                    onChange={(e) => setProjectSite(e.target.value)}
                    placeholder="e.g. Auma India Pvt.Ltd"
                  />
                  <datalist id="wo-project-sites">
                    {projectSiteSuggestions.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div className="space-y-1">
                  <Label>Project Code</Label>
                  <Input value={w_projectCode} onChange={(e) => setProjectCode(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-1">
                  <Label>Category *</Label>
                  <Select value={w_category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue placeholder="Choose category" /></SelectTrigger>
                    <SelectContent>
                      {WO_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label} ({c.value})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Work At (site name)</Label>
                  <Input value={w_workAtName} onChange={(e) => setWorkAtName(e.target.value)} placeholder="e.g. Auma India Pvt.Ltd" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>Work Address (where work happens)</Label>
                  <Textarea value={w_workAddress} onChange={(e) => setWorkAddress(e.target.value)} rows={3} placeholder="Full multi-line site address" />
                </div>
              </div>

              {w_category && (
                <div className="rounded-md bg-primary/5 border border-primary/20 p-3 text-sm">
                  <div className="text-xs text-muted-foreground">WO number will be:</div>
                  <div className="font-mono font-semibold text-primary mt-0.5">HSIPL/{w_category}/&lt;FY&gt;&lt;6-digit-seq&gt;</div>
                </div>
              )}
            </div>
          )}

          {/* STEP 1 — vendor */}
          {wizardStep === 1 && (
            <div className="px-4 lg:px-6 py-4 space-y-4">
              <div className="space-y-2">
                <Label>Pick existing contractor / supplier</Label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Select value={w_supplierId} onValueChange={onSelectExistingSupplier}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Search and select..." /></SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={startNewVendor}>
                    <Plus className="h-4 w-4 mr-1.5" /> New Contractor
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t pt-4">
                <div className="space-y-1 sm:col-span-2">
                  <Label>Vendor / Contractor Name *</Label>
                  <Input value={w_supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="e.g. PSP DESIGN STUDIO & ASSOCIATES" />
                </div>
                <div className="space-y-1">
                  <Label>GSTIN</Label>
                  <Input value={w_supplierGstin} onChange={(e) => setSupplierGstin(e.target.value)} placeholder="15-digit GSTIN" />
                </div>
                <div className="space-y-1">
                  <Label>State</Label>
                  <Input value={w_supplierState} onChange={(e) => setSupplierState(e.target.value)} placeholder="e.g. Delhi" />
                </div>
                <div className="space-y-1">
                  <Label>Kind Attn</Label>
                  <Input value={w_supplierKindAttn} onChange={(e) => setSupplierKindAttn(e.target.value)} placeholder="e.g. MR.PRAMOD AGARWAL" />
                </div>
                <div className="space-y-1">
                  <Label>Phone</Label>
                  <Input value={w_supplierContact} onChange={(e) => setSupplierContact(e.target.value)} placeholder="Contact number" />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input value={w_supplierEmail} onChange={(e) => setSupplierEmail(e.target.value)} placeholder="contact@vendor.com" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>Address</Label>
                  <Textarea value={w_supplierAddress} onChange={(e) => setSupplierAddress(e.target.value)} rows={2} placeholder="Full address" />
                </div>
              </div>

              <div className="border-t pt-4 space-y-2">
                <Label>Vendor rate list (PDF / Image / Excel / CSV, optional)</Label>
                {w_existingRateListUrl && !w_rateListFile && (
                  <div className="text-xs flex items-center gap-2 text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />
                    <a href={w_existingRateListUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      {w_existingRateListFilename ?? "View existing rate list"}
                    </a>
                    <button
                      type="button"
                      onClick={() => { setExistingRateListUrl(null); setExistingRateListFilename(null); }}
                      className="text-destructive hover:text-destructive/70 ml-1"
                      title="Remove this rate list"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <Input
                  type="file"
                  accept=".pdf,image/*,.xlsx,.xls,.xlsm,.xlsb,.csv"
                  onChange={(e) => setRateListFile(e.target.files?.[0] ?? null)}
                />
                {w_rateListFile && (
                  <div className="space-y-2">
                    <div className="text-xs flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5" />
                      <span>{w_rateListFile.name}</span>
                      <button type="button" onClick={() => setRateListFile(null)} className="text-destructive">
                        <XIcon className="h-3 w-3" />
                      </button>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={parseRateListWithAi}
                      disabled={parsingRateList}
                      className="border-primary/40 text-primary hover:bg-primary/5"
                    >
                      {parsingRateList ? "AI parse ho raha hai…" : "✨ Parse with AI (line items auto-fill)"}
                    </Button>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Click "Parse with AI" to auto-fill line items from this file. You can still edit afterwards.
                </p>
              </div>
            </div>
          )}

          {/* STEP 2 — full form */}
          {wizardStep === 2 && (
            <div className="px-4 lg:px-6 py-4 space-y-5">
              {/* Meta grid (left) + dates (right) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Order Meta</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ["Price Basis", w_priceBasis, setPriceBasis],
                      ["Dispatch By", w_dispatchBy, setDispatchBy],
                      ["Freight & Labour", w_freightLabour, setFreightLabour],
                      ["Insurance", w_insurance, setInsurance],
                      ["Packing Terms", w_packingTerms, setPackingTerms],
                      ["Warranty", w_warranty, setWarranty],
                      ["Test Certificate", w_testCertificate, setTestCertificate],
                      ["Transporter", w_transporter, setTransporter],
                    ].map(([label, val, setter]: any) => (
                      <div key={label} className="space-y-0.5">
                        <Label className="text-[11px] text-muted-foreground">{label}</Label>
                        <Input className="h-8 text-xs" value={val} onChange={(e) => setter(e.target.value)} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dates & Payment</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5"><Label className="text-[11px] text-muted-foreground">Delivery Sch</Label><Input type="date" className="h-8 text-xs" value={w_deliverySchedule} onChange={(e) => setDeliverySchedule(e.target.value)} /></div>
                    <div className="space-y-0.5"><Label className="text-[11px] text-muted-foreground">PO Issue Date</Label><Input type="date" className="h-8 text-xs" value={w_poIssueDate} onChange={(e) => setPoIssueDate(e.target.value)} /></div>
                    <div className="space-y-0.5"><Label className="text-[11px] text-muted-foreground">Po upto</Label><Input type="date" className="h-8 text-xs" value={w_poUptoDate} onChange={(e) => setPoUptoDate(e.target.value)} /></div>
                    <div className="space-y-0.5"><Label className="text-[11px] text-muted-foreground">Valid Upto</Label><Input type="date" className="h-8 text-xs" value={w_validUpto} onChange={(e) => setValidUpto(e.target.value)} /></div>
                    <div className="space-y-0.5"><Label className="text-[11px] text-muted-foreground">Effective Date</Label><Input type="date" className="h-8 text-xs" value={w_effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></div>
                    <div className="space-y-0.5"><Label className="text-[11px] text-muted-foreground">Mode of Payment</Label><Input className="h-8 text-xs" value={w_modeOfPayment} onChange={(e) => setModeOfPayment(e.target.value)} /></div>
                    <div className="space-y-0.5 col-span-2"><Label className="text-[11px] text-muted-foreground">Payment Terms</Label><Textarea rows={2} className="text-xs" value={w_paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. 20% Advance Along with Work Order Quoted Price..." /></div>
                  </div>
                </div>
              </div>

              {/* Line items */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Line Items</div>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setAddColumnOpen(true)}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add Column
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setLineItems((p) => [...p, newLineItem()])}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="p-1.5 text-left w-8">#</th>
                        <th className="p-1.5 text-left">Item</th>
                        <th className="p-1.5 text-left">HSN</th>
                        <th className="p-1.5 text-left min-w-[200px]">Description *</th>
                        <th className="p-1.5 text-left">Delivery</th>
                        <th className="p-1.5 text-right">Qty</th>
                        <th className="p-1.5 text-left">Unit</th>
                        <th className="p-1.5 text-right">Rate</th>
                        <th className="p-1.5 text-right">Disc</th>
                        <th className="p-1.5 text-right">Total</th>
                        <th className="p-1.5 text-right">SGST%</th>
                        <th className="p-1.5 text-right">CGST%</th>
                        <th className="p-1.5 text-right">IGST%</th>
                        {w_customColumns.map((c) => (
                          <th key={c.key} className="p-1.5 text-left whitespace-nowrap">
                            <span className="inline-flex items-center gap-1">
                              {c.label}
                              <button type="button" onClick={() => removeCustomColumn(c.key)} className="text-destructive hover:text-destructive/70" title="Remove column">
                                <XIcon className="h-3 w-3" />
                              </button>
                            </span>
                          </th>
                        ))}
                        <th className="p-1.5 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {w_lineItems.map((li, i) => (
                        <tr key={li._key} className="border-t">
                          <td className="p-1 text-center text-muted-foreground">{i + 1}</td>
                          <td className="p-1"><Input className="h-7 text-xs w-24" value={li.item} onChange={(e) => updateLineItem(li._key, { item: e.target.value })} placeholder="Item code" /></td>
                          <td className="p-1"><Input className="h-7 text-xs w-20" value={li.hsn_code} onChange={(e) => updateLineItem(li._key, { hsn_code: e.target.value })} /></td>
                          <td className="p-1"><Textarea rows={1} className="text-xs min-w-[200px] resize-none" value={li.description} onChange={(e) => updateLineItem(li._key, { description: e.target.value })} placeholder="Work description" /></td>
                          <td className="p-1"><Input type="date" className="h-7 text-xs w-32" value={li.delivery_date} onChange={(e) => updateLineItem(li._key, { delivery_date: e.target.value })} /></td>
                          <td className="p-1"><Input type="number" step="0.01" className="h-7 text-xs w-20 text-right" value={li.quantity} onChange={(e) => updateLineItem(li._key, { quantity: e.target.value })} /></td>
                          <td className="p-1"><Input className="h-7 text-xs w-16" value={li.unit} onChange={(e) => updateLineItem(li._key, { unit: e.target.value })} placeholder="SQFT" /></td>
                          <td className="p-1"><Input type="number" step="0.01" className="h-7 text-xs w-24 text-right" value={li.rate} onChange={(e) => updateLineItem(li._key, { rate: e.target.value })} /></td>
                          <td className="p-1"><Input type="number" step="0.01" className="h-7 text-xs w-20 text-right" value={li.discount} onChange={(e) => updateLineItem(li._key, { discount: e.target.value })} /></td>
                          <td className="p-1"><Input type="number" step="0.01" className="h-7 text-xs w-24 text-right font-medium" value={li.total_value} onChange={(e) => updateLineItem(li._key, { total_value: e.target.value })} /></td>
                          <td className="p-1"><Input type="number" step="0.01" className="h-7 text-xs w-16 text-right" value={li.sgst_percent} onChange={(e) => updateLineItem(li._key, { sgst_percent: e.target.value })} /></td>
                          <td className="p-1"><Input type="number" step="0.01" className="h-7 text-xs w-16 text-right" value={li.cgst_percent} onChange={(e) => updateLineItem(li._key, { cgst_percent: e.target.value })} /></td>
                          <td className="p-1"><Input type="number" step="0.01" className="h-7 text-xs w-16 text-right" value={li.igst_percent} onChange={(e) => updateLineItem(li._key, { igst_percent: e.target.value })} /></td>
                          {w_customColumns.map((c) => (
                            <td key={c.key} className="p-1">
                              <Input className="h-7 text-xs min-w-[100px]" value={li.custom_data[c.key] ?? ""} onChange={(e) => setCustomCellValue(li._key, c.key, e.target.value)} />
                            </td>
                          ))}
                          <td className="p-1 text-center">
                            <button type="button" onClick={() => setLineItems((p) => p.filter((x) => x._key !== li._key))} className="text-destructive hover:text-destructive/70" title="Remove row">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-end gap-4 text-sm pt-2">
                  <span>Subtotal: <span className="font-medium">{fmtINR(computedTotals.subtotal)}</span></span>
                  <span>GST: <span className="font-medium">{fmtINR(computedTotals.gstAmount)}</span></span>
                  <span className="text-base">Grand Total: <span className="font-bold text-primary">{fmtINR(computedTotals.grandTotal)}</span></span>
                </div>
              </div>

              {/* Standard Terms */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Terms & Conditions</div>
                  <Button type="button" size="sm" variant="outline" onClick={() => setStandardTerms((p) => [...p, ""])}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Term
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {w_standardTerms.map((t, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="pt-2 text-xs text-muted-foreground w-5 shrink-0">{i + 1}.</span>
                      <Textarea rows={1} className="text-xs flex-1 resize-none" value={t} onChange={(e) => setStandardTerms((p) => p.map((x, idx) => (idx === i ? e.target.value : x)))} />
                      <button type="button" onClick={() => setStandardTerms((p) => p.filter((_, idx) => idx !== i))} className="pt-2 text-destructive hover:text-destructive/70">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Work Remarks */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider text-red-700">Work Remarks (red on PDF)</div>
                  <Button type="button" size="sm" variant="outline" onClick={() => setWorkRemarks((p) => [...p, ""])}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Remark
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {w_workRemarks.map((t, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="pt-2 text-xs text-red-600 w-5 shrink-0">•</span>
                      <Textarea rows={1} className="text-xs flex-1 resize-none border-red-200 focus-visible:ring-red-300" value={t} onChange={(e) => setWorkRemarks((p) => p.map((x, idx) => (idx === i ? e.target.value : x)))} />
                      <button type="button" onClick={() => setWorkRemarks((p) => p.filter((_, idx) => idx !== i))} className="pt-2 text-destructive hover:text-destructive/70">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer signatories */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t pt-3">
                <div className="space-y-1">
                  <Label className="text-xs">Prepared By</Label>
                  <Input value={w_preparedBy} onChange={(e) => setPreparedBy(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Checked By</Label>
                  <Input value={w_checkedBy} onChange={(e) => setCheckedBy(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Authorised Signatory</Label>
                  <Input value={w_authorisedSignatory} onChange={(e) => setAuthorisedSignatory(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3 — preview */}
          {wizardStep === 3 && (
            <div className="px-4 lg:px-6 py-4 space-y-3">
              {pdfBlobUrl ? (
                <iframe src={pdfBlobUrl} className="w-full border rounded" style={{ height: "65vh" }} title="Work Order Preview" />
              ) : (
                <div className="text-center py-12 text-muted-foreground text-sm">Generating PDF preview…</div>
              )}
              <p className="text-xs text-muted-foreground text-center">
                Review the PDF carefully. Click "← Edit" to make changes, or "Finalise" to save and issue this work order.
              </p>
            </div>
          )}

          {/* Footer */}
          <DialogFooter className="px-4 lg:px-6 py-3 border-t bg-muted/20 flex-wrap gap-2 sticky bottom-0">
            {wizardStep > 0 && wizardStep < 3 && (
              <Button variant="outline" onClick={() => setWizardStep((s) => s - 1)} disabled={saving}>
                <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
              </Button>
            )}
            {wizardStep === 3 && (
              <Button variant="outline" onClick={() => setWizardStep(2)} disabled={saving}>
                <ArrowLeft className="h-4 w-4 mr-1.5" /> Edit
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {wizardStep === 2 && (
                <Button variant="outline" onClick={saveDraft} disabled={saving}>
                  <Save className="h-4 w-4 mr-1.5" /> Save Draft
                </Button>
              )}
              {wizardStep < 2 && (
                <Button
                  onClick={() => setWizardStep((s) => s + 1)}
                  disabled={
                    (wizardStep === 0 && (!w_projectSite || !w_category)) ||
                    (wizardStep === 1 && !w_supplierName.trim())
                  }
                >
                  Next <ArrowRight className="h-4 w-4 ml-1.5" />
                </Button>
              )}
              {wizardStep === 2 && (
                <Button onClick={() => { renderPdfPreview(); setWizardStep(3); }}>
                  <Eye className="h-4 w-4 mr-1.5" /> Preview PDF
                </Button>
              )}
              {wizardStep === 3 && (
                <Button onClick={finaliseWO} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  <CheckCircle2 className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : (wizardEditId ? "Save Changes" : "Finalise")}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Custom Column Dialog */}
      <Dialog open={addColumnOpen} onOpenChange={setAddColumnOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Custom Column</DialogTitle>
            <DialogDescription>This column will be added to the line items table and shown in the PDF.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Column name</Label>
            <Input value={newColumnLabel} onChange={(e) => setNewColumnLabel(e.target.value)} placeholder="e.g. Notes, Cess %" maxLength={30} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNewColumnLabel(""); setAddColumnOpen(false); }}>Cancel</Button>
            <Button onClick={addCustomColumn}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
