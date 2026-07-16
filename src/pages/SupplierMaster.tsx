import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fileToClaudeBlock } from "@/lib/imageForClaude";
import { useAuth } from "@/contexts/AuthContext";
import { useDebounce } from "@/hooks/useDebounce";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  Edit3,
  MapPin,
  Mail,
  Phone,
  Plus,
  Search,
  Star,
  Building2,
  ShoppingCart,
  IndianRupee,
  Calendar,
  Upload,
  Sparkles,
  Loader2,
} from "lucide-react";

type SupplierStatus = "active" | "inactive" | "blacklisted";

type Supplier = {
  id: string;
  name: string;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  city: string | null;
  state: string | null;
  status: SupplierStatus;
  performance_score: number | null;
  categories: string[] | null;
  win_rate: number | null;
  blacklist_reason: string | null;
  notes: string | null;
  created_at: string | null;
  profile_complete: boolean | null;
  added_via: string | null;
  verified: boolean | null;
};

type SupplierForm = {
  name: string;
  gstin: string;
  pan: string;
  email: string;
  phone: string;
  whatsapp: string;
  address_text: string;
  city: string;
  state: string;
  pincode: string;
  categoriesText: string;
  notes: string;
};

const formatPct = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return `${n.toFixed(0)}%`;
};

const formatCategories = (cats: string[] | null) => (cats ?? []).filter(Boolean);

export default function SupplierMaster() {
  const { canManageSuppliers, user } = useAuth();

  const [allSuppliers, setAllSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [sortFieldSup, setSortFieldSup] = useState("name");
  const [sortDirSup, setSortDirSup] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Visiting card upload — AI auto-fill
  const [cardUploading, setCardUploading] = useState(false);
  const [cardPreview, setCardPreview] = useState<string | null>(null);

  const handleVisitingCardUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file (JPG, PNG, etc.)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image too large — max 10 MB");
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = () => setCardPreview(reader.result as string);
    reader.readAsDataURL(file);

    setCardUploading(true);
    try {
      // Downscaled to ≤1568px JPEG — card photos are multi-MB; full size just burns tokens.
      const imageBlock = await fileToClaudeBlock(file);

      const { data, error } = await supabase.functions.invoke("claude-proxy", {
        body: {
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              imageBlock,
              {
                type: "text",
                text: `Extract business details from this visiting card / business card image. Return ONLY valid JSON (no markdown fences):
{
  "company_name": "full company name",
  "contact_person": "person name if shown",
  "phone": "10-digit Indian number with +91 if shown, else empty",
  "whatsapp": "usually same as phone, else empty",
  "email": "email if shown",
  "gstin": "15-char GSTIN if shown, else empty",
  "pan": "10-char PAN if shown, else empty",
  "address": "full address line",
  "city": "city",
  "state": "state",
  "pincode": "6-digit pincode",
  "categories": "business type / trade like 'Plumbing, Sanitary' or 'Electrical'"
}
For any field not found on the card, use empty string. For phone, if the card shows multiple numbers, pick the most prominent one.`,
              },
            ],
          }],
        },
      });

      if (error) throw new Error(error.message);
      const raw = data?.content?.[0]?.text || "{}";
      const cleanJson = raw.replace(/```json|```/g, "").trim();
      const extracted = JSON.parse(cleanJson);

      // Pre-fill form with extracted data
      setForm((prev) => ({
        ...prev,
        name: extracted.company_name || prev.name,
        gstin: extracted.gstin || prev.gstin,
        pan: extracted.pan || prev.pan,
        email: extracted.email || prev.email,
        phone: extracted.phone || prev.phone,
        whatsapp: extracted.whatsapp || extracted.phone || prev.whatsapp,
        address_text: extracted.address || prev.address_text,
        city: extracted.city || prev.city,
        state: extracted.state || prev.state,
        pincode: extracted.pincode || prev.pincode,
        categoriesText: extracted.categories || prev.categoriesText,
      }));

      toast.success("Details extracted from visiting card — review and save");
    } catch (e: any) {
      toast.error("Failed to read visiting card: " + (e?.message || "Unknown error"));
    } finally {
      setCardUploading(false);
    }
  };

  const [activeTab, setActiveTab] = useState("complete");

  // Supplier detail + PO history
  type SupplierPO = { id: string; po_number: string; status: string; grand_total: number | null; created_at: string | null; delivery_date: string | null; payment_terms_type: string | null };
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSupplier, setDetailSupplier] = useState<Supplier | null>(null);
  const [detailPOs, setDetailPOs] = useState<SupplierPO[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const openSupplierDetail = async (s: Supplier) => {
    setDetailSupplier(s);
    setDetailOpen(true);
    setDetailLoading(true);
    const { data } = await supabase
      .from("cps_purchase_orders")
      .select("id, po_number, status, grand_total, created_at, delivery_date, payment_terms_type")
      .eq("supplier_id", s.id)
      .order("created_at", { ascending: false });
    setDetailPOs((data ?? []) as SupplierPO[]);
    setDetailLoading(false);
  };

  const [form, setForm] = useState<SupplierForm>({
    name: "",
    gstin: "",
    pan: "",
    email: "",
    phone: "",
    whatsapp: "",
    address_text: "",
    city: "",
    state: "",
    pincode: "",
    categoriesText: "",
    notes: "",
  });

  const fetchSuppliers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("cps_suppliers")
      .select(
        "id,name,gstin,email,phone,whatsapp,city,state,status,performance_score,categories,win_rate,blacklist_reason,notes,created_at,profile_complete,added_via,verified",
      )
      .order("name");

    if (error) {
      toast.error("Failed to load suppliers");
      setAllSuppliers([]);
      setLoading(false);
      return;
    }

    setAllSuppliers((data ?? []) as Supplier[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const total = allSuppliers.length;
    const active = allSuppliers.filter((s) => s.status === "active").length;
    const blacklisted = allSuppliers.filter((s) => s.status === "blacklisted").length;
    return { total, active, blacklisted };
  }, [allSuppliers]);

  // Ready for RFQ = has name + at least one category + phone/whatsapp + city or state.
  // All four are needed for RFQ auto-suggestion (contact to send, location to match, category to filter).
  const isSupplierComplete = (s: Supplier) =>
    !!(s.name && s.name.trim()) &&
    ((s.categories ?? []).filter(Boolean).length > 0) &&
    !!(s.phone?.trim() || s.whatsapp?.trim()) &&
    !!(s.city?.trim() || s.state?.trim());

  const completenessCounts = useMemo(() => {
    let complete = 0;
    allSuppliers.forEach((s) => { if (isSupplierComplete(s)) complete++; });
    return { complete, incomplete: allSuppliers.length - complete };
  }, [allSuppliers]);

  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const supplierCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    allSuppliers.forEach((s) => {
      (s.categories ?? []).forEach((c) => { if (c) set.add(c); });
    });
    return Array.from(set).sort();
  }, [allSuppliers]);

  const toggleSortSup = (field: string) => {
    if (sortFieldSup === field) setSortDirSup((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortFieldSup(field); setSortDirSup("asc"); }
  };

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const list = allSuppliers.filter((s) => {
      const matchesSearch = !q
        ? true
        : (s.name ?? "").toLowerCase().includes(q) ||
          (s.gstin ?? "").toLowerCase().includes(q) ||
          (s.city ?? "").toLowerCase().includes(q);
      const matchesCategory = categoryFilter === "all" ? true : (s.categories ?? []).includes(categoryFilter);
      const matchesTab =
        activeTab === "complete" ? isSupplierComplete(s)
        : activeTab === "incomplete" ? !isSupplierComplete(s)
        : true;
      return matchesSearch && matchesCategory && matchesTab;
    });
    return [...list].sort((a, b) => {
      const av = (a as any)[sortFieldSup] ?? "";
      const bv = (b as any)[sortFieldSup] ?? "";
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDirSup === "asc" ? cmp : -cmp;
    });
  }, [allSuppliers, debouncedSearch, categoryFilter, sortFieldSup, sortDirSup, activeTab]);

  // Reset page when filters or tab change
  useEffect(() => { setPage(0); }, [debouncedSearch, categoryFilter, activeTab]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginatedFiltered = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const openAdd = () => {
    setEditingId(null);
    setForm({
      name: "",
      gstin: "",
      pan: "",
      email: "",
      phone: "",
      whatsapp: "",
      address_text: "",
      city: "",
      state: "",
      pincode: "",
      categoriesText: "",
      notes: "",
    });
    setCardPreview(null);
    setDialogOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditingId(s.id);
    setForm({
      name: s.name ?? "",
      gstin: s.gstin ?? "",
      pan: "",
      email: s.email ?? "",
      phone: s.phone ?? "",
      whatsapp: s.whatsapp ?? "",
      address_text: "",
      city: s.city ?? "",
      state: s.state ?? "",
      pincode: "",
      categoriesText: formatCategories(s.categories).join(", "),
      notes: s.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!user) {
      toast.error("Please sign in");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Supplier name is required");
      return;
    }
    // GSTIN is optional — but if entered, must match the standard 15-char format
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/;
    if (form.gstin.trim() && !gstinRegex.test(form.gstin.trim().toUpperCase())) {
      toast.error("Invalid GSTIN format — must be 15 characters (e.g. 09AAECH3768B1ZM) or leave blank");
      return;
    }
    // PAN: optional — but if entered, must be valid 10-char format
    if (form.pan.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.pan.trim().toUpperCase())) {
      toast.error("Invalid PAN format — must be 10 characters (e.g. ABCDE1234F) or leave blank");
      return;
    }
    // Phone: 10-digit Indian number (optional +91 prefix)
    if (form.phone.trim() && !/^(\+91)?[6-9]\d{9}$/.test(form.phone.trim().replace(/[\s-]/g, ""))) {
      toast.error("Invalid phone number — enter 10-digit Indian mobile number");
      return;
    }
    // Email: basic format check
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error("Invalid email address format");
      return;
    }

    const categoriesArr = form.categoriesText
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    const payload = {
      name: form.name.trim(),
      gstin: form.gstin.trim() || null,
      pan: form.pan.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
      address_text: form.address_text.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      pincode: form.pincode.trim() || null,
      categories: categoriesArr,
      notes: form.notes.trim() || null,
    };

    if (editingId) {
      const { error } = await supabase.from("cps_suppliers").update(payload).eq("id", editingId);
      if (error) {
        toast.error("Failed to update supplier");
        return;
      }
      toast.success("Supplier updated");
      setDialogOpen(false);
      await fetchSuppliers();
      return;
    }

    const { error } = await supabase.from("cps_suppliers").insert([{ ...payload, status: "active" }]);
    if (error) {
      toast.error("Failed to add supplier");
      return;
    }
    toast.success("Supplier added");
    setDialogOpen(false);
    await fetchSuppliers();
  };

  const suppliersContent = (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Suppliers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Not Ready for RFQ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{completenessCounts.incomplete}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search name, GSTIN, city..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent position="popper" sideOffset={4} className="max-h-[50vh] overflow-y-auto z-[300]">
              <SelectItem value="all">All Categories</SelectItem>
              {supplierCategoryOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="text-sm text-muted-foreground flex items-center gap-3">
          <span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} suppliers</span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
              <span className="text-xs px-2">Page {page + 1}/{totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      </div>

      <div className="hidden lg:block">
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortSup("name")}>Supplier Name {sortFieldSup==="name"?(sortDirSup==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead>GSTIN</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortSup("city")}>Location {sortFieldSup==="city"?(sortDirSup==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortSup("performance_score")}>Performance {sortFieldSup==="performance_score"?(sortDirSup==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
                <TableHead>Win Rate</TableHead>
                <TableHead>Registration</TableHead>
                {canManageSuppliers && <TableHead className="text-right">Edit</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">No suppliers found</TableCell>
                </TableRow>
              ) : (
                paginatedFiltered.map((s) => {
                  const complete = isSupplierComplete(s);
                  return (
                    <TableRow key={s.id} className={`cursor-pointer ${complete ? "hover:bg-muted/30" : "bg-amber-50/30 hover:bg-amber-50/50"}`} onClick={() => openSupplierDetail(s)}>
                      <TableCell>
                        <div>
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                            <p className="font-medium text-sm">{s.name}</p>
                          </div>
                          {formatCategories(s.categories).length > 0 && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {formatCategories(s.categories).slice(0, 3).map((c) => (
                                <span key={c} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">{c}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">{s.gstin ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {[s.city, s.state].filter(Boolean).join(", ") || "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          {s.phone && (<div className="flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" /><span>{s.phone}</span></div>)}
                          {s.email && (<div className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3" /><span className="truncate max-w-[160px]">{s.email}</span></div>)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                          <span className="text-sm font-medium">{s.performance_score ?? "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatPct(s.win_rate)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {complete ? (
                            <Badge className="text-xs border-0 bg-green-100 text-green-800 w-fit">Ready for RFQ</Badge>
                          ) : (
                            <Badge className="text-xs border-0 bg-amber-100 text-amber-800 w-fit">Pending Registration</Badge>
                          )}
                          {s.added_via === "legacy_quote" && (
                            <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-300 rounded px-1.5 py-0.5 leading-none w-fit">📄 Added via Quote</span>
                          )}
                          {s.added_via === "rfq_manual" && (
                            <span className="text-[10px] font-semibold bg-purple-100 text-purple-800 border border-purple-300 rounded px-1.5 py-0.5 leading-none w-fit">✋ Added via RFQ</span>
                          )}
                        </div>
                      </TableCell>
                      {canManageSuppliers && (
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {s.profile_complete === false && (
                              <Button variant="outline" size="sm" onClick={() => openEdit(s)} className="text-xs text-amber-700 border-amber-300 hover:bg-amber-50">
                                Complete Profile
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => openEdit(s)} className="text-xs">
                              <Edit3 className="h-3.5 w-3.5 mr-1" />Edit
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </div>

      {/* Cards — mobile */}
      <div className="lg:hidden space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No suppliers found</div>
        ) : (
          paginatedFiltered.map((s) => {
            const complete = isSupplierComplete(s);
            return (
              <Card key={s.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-sm">{s.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{[s.city, s.state].filter(Boolean).join(", ") || "—"}</div>
                    {s.phone && <div className="text-xs text-muted-foreground">{s.phone}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {complete ? (
                      <Badge className="text-xs border-0 bg-green-100 text-green-800">Ready for RFQ</Badge>
                    ) : (
                      <Badge className="text-xs border-0 bg-amber-100 text-amber-800">Pending</Badge>
                    )}
                    {s.performance_score != null && (
                      <div className="flex items-center gap-0.5 text-xs"><Star className="h-3 w-3 text-amber-500 fill-amber-500" />{s.performance_score}</div>
                    )}
                  </div>
                </div>
                {canManageSuppliers && (
                  <Button variant="ghost" size="sm" className="mt-2 h-8 text-xs w-full" onClick={() => openEdit(s)}>
                    <Edit3 className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                )}
              </Card>
            );
          })
        )}
      </div>
    </>
  );

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex items-start justify-between gap-2 lg:gap-4 flex-wrap">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground">Supplier Master</h1>
          <p className="text-muted-foreground text-xs lg:text-sm mt-1">{stats.total} suppliers · {completenessCounts.complete} ready for RFQ · {completenessCounts.incomplete} pending</p>
        </div>
        {canManageSuppliers && (
          <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Naya Supplier Add Karo</Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="complete">
            Ready for RFQ{completenessCounts.complete > 0 ? ` (${completenessCounts.complete})` : ""}
          </TabsTrigger>
          <TabsTrigger value="incomplete">
            Pending Registration{completenessCounts.incomplete > 0 ? ` (${completenessCounts.incomplete})` : ""}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="complete" className="mt-4 space-y-6">{suppliersContent}</TabsContent>
        <TabsContent value="incomplete" className="mt-4 space-y-6">{suppliersContent}</TabsContent>
      </Tabs>

      {/* Add/Edit Supplier Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Supplier" : "Add New Supplier"}</DialogTitle>
            <DialogDescription>{editingId ? "Update supplier details." : "Create a new supplier record."}</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[80vh] pr-2">
          {/* Visiting Card Upload — AI auto-fill (only for new suppliers, not edit) */}
          {!editingId && (
            <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">Quick Add via Visiting Card</span>
                <span className="text-[10px] text-muted-foreground">(optional — AI extracts details from photo)</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={cardUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleVisitingCardUpload(f);
                      e.target.value = "";
                    }}
                  />
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-background hover:bg-muted/40 text-sm font-medium transition-colors">
                    {cardUploading ? (
                      <><Loader2 className="h-4 w-4 animate-spin" />Reading card…</>
                    ) : (
                      <><Upload className="h-4 w-4" />{cardPreview ? "Upload different card" : "Upload visiting card photo"}</>
                    )}
                  </div>
                </label>
                {cardPreview && (
                  <div className="flex items-center gap-2">
                    <img src={cardPreview} alt="Visiting card" className="h-14 w-auto rounded border border-border object-cover" />
                    <button type="button" onClick={() => setCardPreview(null)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Take a clear photo of the vendor's card. AI will extract name, phone, email, GSTIN, address, etc. You can review and edit below before saving.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="md:col-span-2 space-y-1">
              <Label>Supplier name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full company name" />
            </div>
            <div className="space-y-1"><Label>GSTIN</Label><Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="15-digit GSTIN (optional)" /></div>
            <div className="space-y-1"><Label>PAN</Label><Input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value })} placeholder="Optional — e.g. ABCDE1234F" /></div>
            <div className="space-y-1"><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contact@supplier.com" /></div>
            <div className="space-y-1"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 XXXXX XXXXX" /></div>
            <div className="space-y-1"><Label>WhatsApp</Label><Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="+91 XXXXX XXXXX" /></div>
            <div className="space-y-1"><Label>City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" /></div>
            <div className="space-y-1"><Label>State</Label><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="State" /></div>
            <div className="space-y-1"><Label>Pincode</Label><Input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} placeholder="Pincode" /></div>
            <div className="space-y-1 md:col-span-2"><Label>Address</Label><Input value={form.address_text} onChange={(e) => setForm({ ...form, address_text: e.target.value })} placeholder="Full address" /></div>
            <div className="space-y-1 md:col-span-2"><Label>Categories (comma-separated)</Label><Input value={form.categoriesText} onChange={(e) => setForm({ ...form, categoriesText: e.target.value })} placeholder="e.g. MEP, HVAC, Interiors" /></div>
            <div className="space-y-1 md:col-span-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editingId ? "Save Changes" : "Add Supplier"}</Button>
          </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Supplier Detail + PO History Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              {detailSupplier?.name ?? "Supplier"}
            </DialogTitle>
            <DialogDescription>Supplier profile and purchase order history</DialogDescription>
          </DialogHeader>

          {detailSupplier && (
            <div className="space-y-4">
              {/* Profile summary */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">GSTIN: </span>
                  <span className="font-mono font-medium">{detailSupplier.gstin ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Location: </span>
                  <span>{[detailSupplier.city, detailSupplier.state].filter(Boolean).join(", ") || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Phone: </span>
                  <span>{detailSupplier.phone ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Email: </span>
                  <span>{detailSupplier.email ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Performance: </span>
                  <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" /> {detailSupplier.performance_score ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Win Rate: </span>
                  <span>{formatPct(detailSupplier.win_rate)}</span>
                </div>
                {detailSupplier.categories && detailSupplier.categories.length > 0 && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Categories: </span>
                    <span className="inline-flex gap-1 flex-wrap mt-1">
                      {detailSupplier.categories.map((c) => (
                        <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                      ))}
                    </span>
                  </div>
                )}
              </div>

              {/* PO History */}
              <div className="border-t pt-3">
                <div className="flex items-center gap-2 mb-3">
                  <ShoppingCart className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Purchase Order History</h3>
                  <Badge variant="outline" className="text-xs">{detailPOs.length} POs</Badge>
                </div>

                {detailLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : detailPOs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">No purchase orders with this supplier yet</div>
                ) : (
                  <div className="space-y-1.5">
                    {/* Summary */}
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div className="text-center p-2 bg-muted/30 rounded-md">
                        <div className="text-lg font-bold text-foreground">{detailPOs.length}</div>
                        <div className="text-[10px] text-muted-foreground">Total POs</div>
                      </div>
                      <div className="text-center p-2 bg-muted/30 rounded-md">
                        <div className="text-lg font-bold text-foreground">
                          {(() => {
                            const total = detailPOs.reduce((s, p) => s + (p.grand_total ?? 0), 0);
                            if (total >= 10000000) return `${(total / 10000000).toFixed(1)} Cr`;
                            if (total >= 100000) return `${(total / 100000).toFixed(1)} L`;
                            if (total >= 1000) return `${(total / 1000).toFixed(0)} K`;
                            return total.toLocaleString("en-IN");
                          })()}
                        </div>
                        <div className="text-[10px] text-muted-foreground">Total Value</div>
                      </div>
                      <div className="text-center p-2 bg-muted/30 rounded-md">
                        <div className="text-lg font-bold text-foreground">
                          {detailPOs.filter((p) => ["delivered", "closed"].includes(p.status)).length}
                        </div>
                        <div className="text-[10px] text-muted-foreground">Completed</div>
                      </div>
                    </div>

                    {/* PO rows */}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>PO Number</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Delivery</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailPOs.map((po) => (
                          <TableRow key={po.id}>
                            <TableCell className="font-mono text-primary text-xs">{po.po_number}</TableCell>
                            <TableCell className="text-right text-sm">
                              {po.grand_total != null ? `₹${po.grand_total.toLocaleString("en-IN")}` : "—"}
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-[10px] border-0 ${
                                po.status === "approved" || po.status === "sent" ? "bg-green-100 text-green-800" :
                                po.status === "draft" ? "bg-muted text-muted-foreground" :
                                po.status === "delivered" || po.status === "closed" ? "bg-emerald-100 text-emerald-800" :
                                po.status === "cancelled" || po.status === "rejected" ? "bg-red-100 text-red-800" :
                                "bg-blue-100 text-blue-800"
                              }`}>{po.status}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {po.created_at ? new Date(po.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {po.delivery_date ? new Date(po.delivery_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

