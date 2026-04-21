import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  status: SupplierStatus;
};

const statusConfig: Record<SupplierStatus, { badge: string; label: string }> = {
  active: { badge: "bg-green-100 text-green-800 border-green-200", label: "active" },
  inactive: { badge: "bg-muted text-muted-foreground border-border/80", label: "inactive" },
  blacklisted: { badge: "bg-red-100 text-red-800 border-red-200", label: "blacklisted" },
};

const formatPct = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return `${n.toFixed(0)}%`;
};

const formatCategories = (cats: string[] | null) => (cats ?? []).filter(Boolean);

type VendorRegistration = {
  id: string;
  company_name: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  gstin: string | null;
  city: string | null;
  state: string | null;
  categories: string[] | null;
  regions: string[] | null;
  submitted_at: string | null;
  created_at: string | null;
};

export default function SupplierMaster() {
  const { canManageSuppliers, user } = useAuth();
  const isProcurementHead = user?.role === "procurement_head" || user?.role === "it_head";

  const [allSuppliers, setAllSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [statusFilter, setStatusFilter] = useState<SupplierStatus | "all">("all");
  const [sortFieldSup, setSortFieldSup] = useState("name");
  const [sortDirSup, setSortDirSup] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [pendingRegs, setPendingRegs] = useState<VendorRegistration[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("suppliers");

  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [approveTarget, setApproveTarget] = useState<VendorRegistration | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<VendorRegistration | null>(null);
  const [rejectReason, setRejectReason] = useState("");

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
    status: "active",
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

  const fetchPendingRegs = async () => {
    setPendingLoading(true);
    try {
      const { data, error } = await supabase
        .from("cps_vendor_registrations")
        .select("id,company_name,contact_person,email,phone,whatsapp,gstin,city,state,categories,regions,submitted_at,created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setPendingRegs((data ?? []) as VendorRegistration[]);
    } catch {
      setPendingRegs([]);
    } finally {
      setPendingLoading(false);
    }
  };

  const approveRegistration = async () => {
    if (!user || !approveTarget) return;
    try {
      const reg = approveTarget;
      const categoriesArr = (reg.categories ?? []).filter(Boolean);

      const { data: newSup, error: insErr } = await supabase
        .from("cps_suppliers")
        .insert([{
          name: reg.company_name ?? "Unnamed",
          email: reg.email ?? null,
          phone: reg.phone ?? null,
          whatsapp: reg.whatsapp ?? null,
          gstin: reg.gstin ?? null,
          city: reg.city ?? null,
          state: reg.state ?? null,
          categories: categoriesArr.length ? categoriesArr : null,
          status: "active",
        }])
        .select("id")
        .single();
      if (insErr) throw insErr;

      const newSupplierId = (newSup as any).id;
      const { error: updErr } = await supabase
        .from("cps_vendor_registrations")
        .update({
          status: "approved",
          supplier_id: newSupplierId,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", reg.id);
      if (updErr) throw updErr;

      toast.success("Vendor approved and added to supplier master");
      setApproveConfirmOpen(false);
      setApproveTarget(null);
      await Promise.all([fetchSuppliers(), fetchPendingRegs()]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to approve vendor");
    }
  };

  const rejectRegistration = async () => {
    if (!user || !rejectTarget) return;
    if (!rejectReason.trim()) {
      toast.error("Rejection reason is required");
      return;
    }
    try {
      const { error } = await supabase
        .from("cps_vendor_registrations")
        .update({
          status: "rejected",
          rejection_reason: rejectReason.trim(),
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", rejectTarget.id);
      if (error) throw error;

      toast.success("Registration rejected");
      setRejectDialogOpen(false);
      setRejectTarget(null);
      setRejectReason("");
      await fetchPendingRegs();
    } catch (e: any) {
      toast.error(e?.message || "Failed to reject registration");
    }
  };

  useEffect(() => {
    fetchSuppliers();
    if (isProcurementHead) fetchPendingRegs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const total = allSuppliers.length;
    const active = allSuppliers.filter((s) => s.status === "active").length;
    const blacklisted = allSuppliers.filter((s) => s.status === "blacklisted").length;
    return { total, active, blacklisted };
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
      const matchesStatus = statusFilter === "all" ? true : s.status === statusFilter;
      const matchesSearch = !q
        ? true
        : (s.name ?? "").toLowerCase().includes(q) ||
          (s.gstin ?? "").toLowerCase().includes(q) ||
          (s.city ?? "").toLowerCase().includes(q);
      const matchesCategory = categoryFilter === "all" ? true : (s.categories ?? []).includes(categoryFilter);
      return matchesStatus && matchesSearch && matchesCategory;
    });
    return [...list].sort((a, b) => {
      const av = (a as any)[sortFieldSup] ?? "";
      const bv = (b as any)[sortFieldSup] ?? "";
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDirSup === "asc" ? cmp : -cmp;
    });
  }, [allSuppliers, debouncedSearch, statusFilter, categoryFilter, sortFieldSup, sortDirSup]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [debouncedSearch, statusFilter, categoryFilter]);

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
      status: "active",
    });
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
      status: s.status,
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
    if (!form.gstin.trim()) {
      toast.error("GSTIN is required");
      return;
    }
    // GSTIN format: 2 digits + 5 alpha + 4 digits + 1 alpha + 1 alphanum + Z + 1 alphanum
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/;
    if (!gstinRegex.test(form.gstin.trim().toUpperCase())) {
      toast.error("Invalid GSTIN format — must be 15 characters (e.g. 09AAECH3768B1ZM)");
      return;
    }
    // PAN format: 5 alpha + 4 digits + 1 alpha
    if (form.pan.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.pan.trim().toUpperCase())) {
      toast.error("Invalid PAN format — must be 10 characters (e.g. ABCDE1234F)");
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
      status: form.status,
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

    const { error } = await supabase.from("cps_suppliers").insert([payload]);
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Blacklisted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.blacklisted}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search name, GSTIN, city..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="blacklisted">Blacklisted</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
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
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSortSup("status")}>Status {sortFieldSup==="status"?(sortDirSup==="asc"?"↑":"↓"):<span className="text-muted-foreground/40">↕</span>}</TableHead>
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
                  const sb = statusConfig[s.status];
                  return (
                    <TableRow key={s.id} className={s.profile_complete === false ? "bg-amber-50/30 hover:bg-amber-50/50" : "hover:bg-muted/30"}>
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
                          {s.status === "blacklisted" && s.blacklist_reason ? (
                            <Tooltip>
                              <TooltipTrigger asChild><Badge className={`text-xs border-0 ${sb.badge}`}>{sb.label}</Badge></TooltipTrigger>
                              <TooltipContent><div className="max-w-[260px] text-xs">{s.blacklist_reason}</div></TooltipContent>
                            </Tooltip>
                          ) : (
                            <Badge className={`text-xs border-0 ${sb.badge}`}>{sb.label}</Badge>
                          )}
                          {s.profile_complete === false && (
                            <span className="text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-300 rounded px-1.5 py-0.5 leading-none w-fit">📝 INCOMPLETE</span>
                          )}
                          {s.verified === false && s.profile_complete !== false && (
                            <span className="text-[10px] font-semibold bg-orange-100 text-orange-700 border border-orange-300 rounded px-1.5 py-0.5 leading-none w-fit">⚠️ Unverified</span>
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
                        <TableCell className="text-right">
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
            const sb = statusConfig[s.status];
            return (
              <Card key={s.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-sm">{s.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{[s.city, s.state].filter(Boolean).join(", ") || "—"}</div>
                    {s.phone && <div className="text-xs text-muted-foreground">{s.phone}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge className={`text-xs border-0 ${sb.badge}`}>{sb.label}</Badge>
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

  const pendingContent = (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company Name</TableHead>
              <TableHead>Contact Person</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Categories</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pendingLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : pendingRegs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No pending registrations</TableCell>
              </TableRow>
            ) : (
              pendingRegs.map((reg) => (
                <TableRow key={reg.id} className="hover:bg-muted/30">
                  <TableCell className="font-medium">{reg.company_name ?? "—"}</TableCell>
                  <TableCell>{reg.contact_person ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{reg.email ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{reg.phone ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {(reg.categories ?? []).slice(0, 2).map((c) => (
                        <span key={c} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">{c}</span>
                      ))}
                      {(reg.categories ?? []).length > 2 && (
                        <span className="text-xs text-muted-foreground">+{(reg.categories ?? []).length - 2}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {reg.submitted_at || reg.created_at
                      ? new Date(reg.submitted_at ?? reg.created_at!).toLocaleDateString("en-IN")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => { setApproveTarget(reg); setApproveConfirmOpen(true); }}>Approve</Button>
                      <Button size="sm" variant="destructive" onClick={() => { setRejectTarget(reg); setRejectReason(""); setRejectDialogOpen(true); }}>Reject</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Supplier Master</h1>
          <p className="text-muted-foreground text-sm mt-1">{stats.active} active suppliers</p>
        </div>
        {canManageSuppliers && (
          <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Add Supplier</Button>
        )}
      </div>

      {isProcurementHead ? (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="suppliers">All Suppliers</TabsTrigger>
            <TabsTrigger value="pending">
              Pending Registrations{pendingRegs.length > 0 ? ` (${pendingRegs.length})` : ""}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="suppliers" className="mt-4 space-y-6">{suppliersContent}</TabsContent>
          <TabsContent value="pending" className="mt-4 space-y-4">{pendingContent}</TabsContent>
        </Tabs>
      ) : (
        <div className="space-y-6">{suppliersContent}</div>
      )}

      {/* Add/Edit Supplier Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Supplier" : "Add New Supplier"}</DialogTitle>
            <DialogDescription>{editingId ? "Update supplier details." : "Create a new supplier record."}</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[80vh] pr-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="md:col-span-2 space-y-1">
              <Label>Supplier name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full company name" />
            </div>
            <div className="space-y-1"><Label>GSTIN <span className="text-destructive">*</span></Label><Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="15-digit GSTIN" required /></div>
            <div className="space-y-1"><Label>PAN</Label><Input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value })} placeholder="PAN" /></div>
            <div className="space-y-1"><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contact@supplier.com" /></div>
            <div className="space-y-1"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 XXXXX XXXXX" /></div>
            <div className="space-y-1"><Label>WhatsApp</Label><Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="+91 XXXXX XXXXX" /></div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as SupplierStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">active</SelectItem>
                  <SelectItem value="inactive">inactive</SelectItem>
                  <SelectItem value="blacklisted">blacklisted</SelectItem>
                </SelectContent>
              </Select>
            </div>
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

      {/* Approve Confirmation Dialog */}
      <Dialog open={approveConfirmOpen} onOpenChange={setApproveConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Vendor Registration</DialogTitle>
            <DialogDescription>
              This will create a new supplier record for <span className="font-medium">{approveTarget?.company_name}</span> and mark the registration as approved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveConfirmOpen(false)}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={approveRegistration}>Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Registration</DialogTitle>
            <DialogDescription>Provide a reason for rejecting {rejectTarget?.company_name}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <Label>Rejection Reason *</Label>
            <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Required reason for rejection" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={rejectRegistration}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

