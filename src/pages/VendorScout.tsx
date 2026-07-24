import React, { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  Download, ExternalLink, Loader2, Radar, RefreshCw, Search, Star, Trash2, UserPlus, CheckCircle2,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Vendor Scout — the standalone scraper-app-v2 (Railway + Vercel) folded into CPS.
//
// The old app ended at a starred row: someone then retyped the vendor into the
// supplier master by hand. Here, "Add to Suppliers" does that in one click and
// records the link back on the lead, which is the whole reason for the move.
// ─────────────────────────────────────────────────────────────────────────────

export type VendorLead = {
  id: number;
  business_name: string;
  phone: string | null;
  address: string | null;
  gst: string | null;
  city: string;
  category: string;
  website: string | null;
  rating: number | null;
  reviews: number | null;
  final_score: number | null;
  source_url: string | null;
  place_id: string | null;
  is_shortlisted: boolean | null;
  lead_type: string;
  status: string;
  converted_supplier_id: string | null;
  created_at: string | null;
};

const KEYWORDS = [
  "Electrical Contractor", "Plumber", "Carpenter", "Painter",
  "Tile Contractor", "Stone Contractor", "HVAC Contractor",
  "False Ceiling Contractor", "Interior Designer", "Civil Contractor",
  "Waterproofing Contractor", "Flooring Contractor", "Welder",
  "Fabricator", "Mason", "Glass Contractor",
];

const CITIES = [
  "Delhi", "Mumbai", "Bangalore", "Hyderabad", "Chennai", "Pune",
  "Kolkata", "Gurgaon", "Noida", "Jaipur", "Ahmedabad", "Lucknow",
  "Chandigarh", "Indore", "Ludhiana", "Ghaziabad", "Faridabad",
  "Nagpur", "Bhopal", "Patna", "Kochi",
];

const LEAD_COLUMNS =
  "id,business_name,phone,address,gst,city,category,website,rating,reviews,final_score," +
  "source_url,place_id,is_shortlisted,lead_type,status,converted_supplier_id,created_at";

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * supabase-js throws away the response body on a non-2xx from an edge function and
 * leaves you with a bare "Edge Function returned a non-2xx status code". The real
 * message is on error.context (the raw Response), so dig it out — otherwise every
 * failure here is undebuggable from the UI.
 */
async function invokeScout(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("vendor-scout", { body });

  if (error) {
    let message = error.message;
    const res = (error as { context?: Response }).context;
    if (res && typeof res.json === "function") {
      try {
        const parsed = await res.json();
        if (parsed?.error) message = parsed.error;
      } catch {
        // Body wasn't JSON — keep the generic message.
      }
    }
    throw new Error(message);
  }

  if (data?.error) throw new Error(data.error);
  return data;
}

/** Strip everything but digits and drop a leading 91 — the same shape the leads table stores. */
function phoneKey(phone: string | null | undefined): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

function ageLabel(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 60) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCSV(rows: VendorLead[]) {
  const headers = [
    "#", "Business Name", "Phone", "Address", "GST", "Category",
    "City", "Rating", "Reviews", "Website", "Source URL", "Shortlisted", "Status",
  ];
  const lines = [headers.join(",")];
  rows.forEach((r, i) => {
    lines.push([
      i + 1, escapeCSV(r.business_name), escapeCSV(r.phone), escapeCSV(r.address),
      escapeCSV(r.gst), escapeCSV(r.category), escapeCSV(r.city), r.rating ?? "",
      r.reviews ?? 0, escapeCSV(r.website), escapeCSV(r.source_url),
      r.is_shortlisted ? "yes" : "no", escapeCSV(r.status),
    ].join(","));
  });

  // BOM so Excel opens the Hindi/Devanagari business names correctly.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vendor-scout-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function VendorScout() {
  const { user, canManageSuppliers } = useAuth();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState("search");

  // Search form
  const [keyword, setKeyword] = useState("");
  const [city, setCity] = useState("");
  const [maxResults, setMaxResults] = useState(5);
  const [leadType, setLeadType] = useState<"vendor" | "contractor">("contractor");

  const [scraping, setScraping] = useState(false);
  const [scrapeStage, setScrapeStage] = useState("");
  const [results, setResults] = useState<VendorLead[]>([]);
  const [resultMeta, setResultMeta] = useState<{ cached: boolean; message: string } | null>(null);

  // Saved-data browser
  const [savedCity, setSavedCity] = useState("");
  const [savedCategory, setSavedCategory] = useState("");

  const [convertLead, setConvertLead] = useState<VendorLead | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: facets } = useQuery({
    queryKey: ["vendor-scout", "facets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cps_vendor_leads")
        .select("city,category")
        .limit(5000);
      if (error) throw error;
      const cities = [...new Set((data ?? []).map((r) => r.city).filter(Boolean))].sort();
      const byCity: Record<string, string[]> = {};
      (data ?? []).forEach((r) => {
        if (!r.city) return;
        byCity[r.city] = byCity[r.city] ?? [];
        if (r.category && !byCity[r.city].includes(r.category)) byCity[r.city].push(r.category);
      });
      Object.values(byCity).forEach((c) => c.sort());
      return { cities, byCity };
    },
  });

  const { data: savedRows, isFetching: savedLoading } = useQuery({
    queryKey: ["vendor-scout", "saved", savedCity, savedCategory],
    enabled: Boolean(savedCity),
    queryFn: async () => {
      let q = supabase.from("cps_vendor_leads").select(LEAD_COLUMNS).eq("city", savedCity);
      if (savedCategory) q = q.eq("category", savedCategory);
      const { data, error } = await q.order("final_score", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as VendorLead[];
    },
  });

  const { data: shortlistedRows, isFetching: shortlistLoading } = useQuery({
    queryKey: ["vendor-scout", "shortlisted"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cps_vendor_leads")
        .select(LEAD_COLUMNS)
        .eq("is_shortlisted", true)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as VendorLead[];
    },
  });

  // Every supplier phone/GSTIN in the master, so a lead already on file is
  // labelled instead of offering a button that would create a duplicate.
  const { data: supplierIndex } = useQuery({
    queryKey: ["vendor-scout", "supplier-index"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cps_suppliers")
        .select("id,name,phone,whatsapp,gstin")
        .limit(5000);
      if (error) throw error;
      const byPhone = new Map<string, { id: string; name: string }>();
      const byGstin = new Map<string, { id: string; name: string }>();
      const byName = new Map<string, { id: string; name: string }>();
      (data ?? []).forEach((s) => {
        const entry = { id: s.id as string, name: s.name as string };
        [s.phone, s.whatsapp].forEach((p) => {
          const k = phoneKey(p as string | null);
          if (k.length === 10) byPhone.set(k, entry);
        });
        if (s.gstin) byGstin.set(String(s.gstin).toUpperCase().trim(), entry);
        if (s.name) byName.set(String(s.name).toLowerCase().trim(), entry);
      });
      return { byPhone, byGstin, byName };
    },
  });

  const findExistingSupplier = (lead: VendorLead) => {
    if (!supplierIndex) return null;
    const k = phoneKey(lead.phone);
    return (
      (k.length === 10 ? supplierIndex.byPhone.get(k) : undefined) ??
      (lead.gst ? supplierIndex.byGstin.get(lead.gst.toUpperCase().trim()) : undefined) ??
      supplierIndex.byName.get(lead.business_name.toLowerCase().trim()) ??
      null
    );
  };

  const invalidateLeads = () => {
    queryClient.invalidateQueries({ queryKey: ["vendor-scout"] });
  };

  // ── Search ────────────────────────────────────────────────────────────────

  /** Cache-first, exactly like the old backend: saved rows win unless "fetch fresh". */
  const runSearch = async () => {
    const kw = keyword.trim().toLowerCase();
    const ct = city.trim().toLowerCase();
    if (kw.length < 2 || ct.length < 2) {
      toast.error("Enter both a keyword and a city");
      return;
    }

    setResults([]);
    setResultMeta(null);
    setScraping(true);
    setScrapeStage("Checking saved data…");

    try {
      const { data, error } = await supabase
        .from("cps_vendor_leads")
        .select(LEAD_COLUMNS)
        .eq("city", ct)
        .eq("category", kw)
        .order("final_score", { ascending: false })
        .limit(maxResults);
      if (error) throw error;

      const cached = (data ?? []) as unknown as VendorLead[];
      if (cached.length > 0) {
        setResults(cached);
        setResultMeta({
          cached: true,
          message:
            cached.length >= maxResults
              ? `${cached.length} saved result(s), last updated ${ageLabel(cached[0].created_at)}.`
              : `Only ${cached.length} saved result(s) — you asked for ${maxResults}.`,
        });
        return;
      }
      await scrapeFresh(kw, ct);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      setScraping(false);
      setScrapeStage("");
    }
  };

  /** Start an Apify run and poll it — the run outlives a single edge-function call. */
  const scrapeFresh = async (kwIn?: string, ctIn?: string) => {
    const kw = (kwIn ?? keyword).trim().toLowerCase();
    const ct = (ctIn ?? city).trim().toLowerCase();
    if (kw.length < 2 || ct.length < 2) {
      toast.error("Enter both a keyword and a city");
      return;
    }

    const standalone = kwIn === undefined;
    if (standalone) {
      setScraping(true);
      setResults([]);
      setResultMeta(null);
    }

    try {
      setScrapeStage("Starting search on Google Maps…");
      const payload = { keyword: kw, city: ct, max_results: maxResults, lead_type: leadType };

      const startData = await invokeScout({ action: "start", ...payload });
      const runId = startData?.run_id as string;
      const deadline = Date.now() + POLL_TIMEOUT_MS;

      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        setScrapeStage("Collecting results… this usually takes 30–90 seconds");

        const pollData = await invokeScout({ action: "poll", run_id: runId, ...payload });

        if (pollData.status === "done") {
          const rows = (pollData.rows ?? []) as VendorLead[];
          setResults(rows);
          setResultMeta({
            cached: false,
            message: pollData.save_error
              // Rows on screen but nothing in the table — never let this look like success.
              ? `${rows.length} result(s) found but NOT SAVED: ${pollData.save_error}`
              : rows.length === 0
                ? `No usable results for "${kw}" in "${ct}". ${pollData.raw_count ?? 0} raw place(s) were all filtered out (no phone, closed, or wrong city).`
                : `${rows.length} result(s), ${pollData.new_count ?? 0} newly added.`,
          });
          if (pollData.save_error) toast.error(`Not saved: ${pollData.save_error}`);
          else if (rows.length > 0) toast.success(`Found ${rows.length} ${leadType}(s)`);
          invalidateLeads();
          return;
        }
      }
      throw new Error("Search timed out after 4 minutes — try again with fewer results");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      if (standalone) setScraping(false);
      setScrapeStage("");
    }
  };

  // ── Row actions ───────────────────────────────────────────────────────────

  const toggleShortlist = useMutation({
    mutationFn: async (lead: VendorLead) => {
      const next = !lead.is_shortlisted;
      const { error } = await supabase
        .from("cps_vendor_leads")
        .update({
          is_shortlisted: next,
          // Don't stomp on a lead that has already become a supplier.
          ...(lead.status === "converted" ? {} : { status: next ? "shortlisted" : "new" }),
        })
        .eq("id", lead.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next, lead) => {
      setResults((rs) => rs.map((r) => (r.id === lead.id ? { ...r, is_shortlisted: next } : r)));
      invalidateLeads();
    },
    onError: (e: Error) => toast.error(e.message || "Could not update shortlist"),
  });

  const deleteLead = useMutation({
    mutationFn: async (lead: VendorLead) => {
      const { error } = await supabase.from("cps_vendor_leads").delete().eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: (_d, lead) => {
      setResults((rs) => rs.filter((r) => r.id !== lead.id));
      invalidateLeads();
      toast.success("Lead deleted");
    },
    onError: (e: Error) => toast.error(e.message || "Could not delete lead"),
  });

  // ── Convert to supplier ───────────────────────────────────────────────────

  const convert = useMutation({
    mutationFn: async ({ lead, form }: { lead: VendorLead; form: ConvertForm }) => {
      const phone = phoneKey(form.phone);

      const { data: supplier, error } = await supabase
        .from("cps_suppliers")
        .insert([{
          name: form.name.trim(),
          phone: phone || null,
          whatsapp: phone ? `91${phone}` : null,
          gstin: form.gstin.trim() ? form.gstin.trim().toUpperCase() : null,
          email: form.email.trim() || null,
          address_text: form.address.trim() || null,
          city: form.city.trim() || null,
          categories: form.categories.split(",").map((c) => c.trim()).filter(Boolean),
          status: "active",
          added_via: "vendor_scout",
          // Google Maps data is unverified and has no bank/PAN details — the
          // supplier still has to be completed and verified by procurement.
          verified: false,
          profile_complete: false,
          notes: `Added from Vendor Scout (${lead.lead_type}) — Google Maps${
            lead.source_url ? `: ${lead.source_url}` : ""
          }`,
        }])
        .select("id,name")
        .single();
      if (error) throw error;

      await supabase
        .from("cps_vendor_leads")
        .update({
          status: "converted",
          converted_supplier_id: supplier.id,
          converted_by: user?.id ?? null,
          converted_at: new Date().toISOString(),
        })
        .eq("id", lead.id);

      await supabase.from("cps_audit_log").insert({
        user_id: user?.id ?? null,
        user_name: user?.name ?? null,
        user_role: user?.role ?? null,
        action_type: "VENDOR_SCOUT_CONVERT",
        entity_type: "supplier",
        entity_id: supplier.id,
        description: `Vendor Scout lead "${lead.business_name}" (${lead.city}/${lead.category}) added to supplier master`,
        after_value: { lead_id: lead.id, supplier_id: supplier.id, lead_type: lead.lead_type },
        severity: "info",
      });

      return supplier;
    },
    onSuccess: (supplier, { lead }) => {
      setResults((rs) =>
        rs.map((r) => (r.id === lead.id ? { ...r, status: "converted", converted_supplier_id: supplier.id } : r)),
      );
      setConvertLead(null);
      invalidateLeads();
      toast.success(`"${supplier.name}" added to Supplier Master`);
    },
    onError: (e: Error) => toast.error(e.message || "Could not add supplier"),
  });

  const savedCategories = savedCity ? facets?.byCity?.[savedCity] ?? [] : [];

  // ── Render ────────────────────────────────────────────────────────────────

  const renderTable = (rows: VendorLead[], emptyText: string) => {
    if (rows.length === 0) {
      return <p className="text-sm text-muted-foreground py-8 text-center">{emptyText}</p>;
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{rows.length} result(s)</p>
          <Button variant="outline" size="sm" onClick={() => downloadCSV(rows)}>
            <Download className="h-4 w-4 mr-1.5" /> Export CSV
          </Button>
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="max-w-[280px]">Address</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const existing = findExistingSupplier(r);
                const isConverted = r.status === "converted" || Boolean(r.converted_supplier_id);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => toggleShortlist.mutate(r)}
                        aria-label={r.is_shortlisted ? "Remove from shortlist" : "Add to shortlist"}
                        className="text-secondary hover:opacity-70 transition-opacity"
                      >
                        <Star className={`h-4 w-4 ${r.is_shortlisted ? "fill-current" : ""}`} />
                      </button>
                    </TableCell>

                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {r.source_url ? (
                          <a
                            href={r.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            {r.business_name}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          r.business_name
                        )}
                      </div>
                      {r.gst && <span className="text-xs text-muted-foreground">GST {r.gst}</span>}
                    </TableCell>

                    <TableCell className="whitespace-nowrap">{r.phone || "—"}</TableCell>
                    <TableCell className="max-w-[280px] text-xs text-muted-foreground">
                      {r.address || "—"}
                    </TableCell>
                    <TableCell className="text-xs capitalize">{r.category}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {r.rating ? `${r.rating} (${r.reviews ?? 0})` : "—"}
                    </TableCell>

                    <TableCell className="text-right whitespace-nowrap">
                      {isConverted || existing ? (
                        <Badge variant="outline" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {isConverted ? "In Supplier Master" : `Already listed: ${existing?.name}`}
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canManageSuppliers}
                          onClick={() => setConvertLead(r)}
                        >
                          <UserPlus className="h-4 w-4 mr-1.5" /> Add to Suppliers
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-1 text-destructive"
                        onClick={() => deleteLead.mutate(r)}
                        aria-label="Delete lead"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Radar className="h-6 w-6 text-primary" /> Vendor Scout
        </h1>
        <p className="text-sm text-muted-foreground">
          Find vendors and contractors on Google Maps, then add the good ones straight to the supplier master.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="saved">Saved Data</TabsTrigger>
          <TabsTrigger value="shortlisted">
            Shortlisted{shortlistedRows?.length ? ` (${shortlistedRows.length})` : ""}
          </TabsTrigger>
        </TabsList>

        {/* ── Search ─────────────────────────────────────────────────────── */}
        <TabsContent value="search" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Search vendors &amp; contractors</CardTitle>
              <CardDescription>
                Saved results are shown instantly. A fresh search costs Apify credit, so it is capped
                per day and written to the audit log.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="vs-keyword">Keyword / Trade</Label>
                  <Input
                    id="vs-keyword"
                    list="vs-keywords"
                    placeholder="e.g. Painter"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    disabled={scraping}
                  />
                  <datalist id="vs-keywords">
                    {KEYWORDS.map((k) => <option key={k} value={k} />)}
                  </datalist>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="vs-city">City</Label>
                  <Input
                    id="vs-city"
                    list="vs-cities"
                    placeholder="e.g. Delhi"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    disabled={scraping}
                  />
                  <datalist id="vs-cities">
                    {CITIES.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="vs-type">Type</Label>
                  <Select value={leadType} onValueChange={(v) => setLeadType(v as "vendor" | "contractor")}>
                    <SelectTrigger id="vs-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contractor">Contractor</SelectItem>
                      <SelectItem value="vendor">Vendor / Supplier</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="vs-max">Max Results</Label>
                  <Input
                    id="vs-max"
                    type="number"
                    min={1}
                    max={50}
                    value={maxResults}
                    onChange={(e) => setMaxResults(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                    disabled={scraping}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={runSearch} disabled={scraping}>
                  {scraping
                    ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    : <Search className="h-4 w-4 mr-1.5" />}
                  {scraping ? "Searching…" : "Search"}
                </Button>
                <Button variant="outline" onClick={() => scrapeFresh()} disabled={scraping}>
                  <RefreshCw className="h-4 w-4 mr-1.5" /> Fetch fresh from Google Maps
                </Button>
              </div>

              {scraping && scrapeStage && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> {scrapeStage}
                </p>
              )}

              {resultMeta && !scraping && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm flex flex-wrap items-center gap-3">
                  <Badge variant={resultMeta.cached ? "outline" : "default"}>
                    {resultMeta.cached ? "From saved data" : "Fresh search"}
                  </Badge>
                  <span className="text-muted-foreground">{resultMeta.message}</span>
                  {resultMeta.cached && (
                    <Button size="sm" variant="ghost" onClick={() => scrapeFresh()}>
                      Fetch fresh instead
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {results.length > 0 && !scraping && (
            <Card>
              <CardContent className="pt-6">{renderTable(results, "No results.")}</CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Saved ──────────────────────────────────────────────────────── */}
        <TabsContent value="saved" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saved data</CardTitle>
              <CardDescription>Everything scouted so far, browsable by city and trade.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>City</Label>
                  <Select
                    value={savedCity}
                    onValueChange={(v) => { setSavedCity(v); setSavedCategory(""); }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select a city" /></SelectTrigger>
                    <SelectContent>
                      {(facets?.cities ?? []).map((c) => (
                        <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {savedCategories.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>Category</Label>
                    <Select value={savedCategory} onValueChange={setSavedCategory}>
                      <SelectTrigger><SelectValue placeholder="All categories" /></SelectTrigger>
                      <SelectContent>
                        {savedCategories.map((c) => (
                          <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {savedLoading
                ? <Skeleton className="h-40 w-full" />
                : renderTable(savedRows ?? [], savedCity ? "No leads for this filter." : "Pick a city to browse.")}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Shortlisted ────────────────────────────────────────────────── */}
        <TabsContent value="shortlisted">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Shortlisted leads</CardTitle>
              <CardDescription>Starred vendors and contractors across every city.</CardDescription>
            </CardHeader>
            <CardContent>
              {shortlistLoading
                ? <Skeleton className="h-40 w-full" />
                : renderTable(shortlistedRows ?? [], "Nothing shortlisted yet — star a lead to keep it here.")}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Rendered conditionally with a key so the form always starts from this lead. */}
      {convertLead && (
        <ConvertDialog
          key={convertLead.id}
          lead={convertLead}
          saving={convert.isPending}
          onCancel={() => setConvertLead(null)}
          onSave={(form) => convert.mutate({ lead: convertLead, form })}
        />
      )}
    </div>
  );
}

// ─── Convert dialog ──────────────────────────────────────────────────────────

type ConvertForm = {
  name: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  city: string;
  categories: string;
};

function ConvertDialog({
  lead, saving, onCancel, onSave,
}: {
  lead: VendorLead;
  saving: boolean;
  onCancel: () => void;
  onSave: (form: ConvertForm) => void;
}) {
  // Initialised once from the lead — the parent remounts via key={lead.id}, so
  // there is no prop-to-state sync effect here (and no stale-render flash).
  const [form, setForm] = useState<ConvertForm>({
    name: lead.business_name ?? "",
    phone: lead.phone ?? "",
    email: "",
    gstin: lead.gst ?? "",
    address: lead.address ?? "",
    city: lead.city ?? "",
    categories: lead.category ?? "",
  });

  const set = (k: keyof ConvertForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to Supplier Master</DialogTitle>
          <DialogDescription>
            Google Maps has no PAN, GSTIN or bank details — this supplier is created unverified
            and with an incomplete profile, for procurement to finish.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cv-name">Supplier name *</Label>
            <Input id="cv-name" value={form.name} onChange={set("name")} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cv-phone">Phone / WhatsApp</Label>
              <Input id="cv-phone" value={form.phone} onChange={set("phone")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cv-email">Email</Label>
              <Input id="cv-email" value={form.email} onChange={set("email")} placeholder="Not on Google Maps" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cv-gstin">GSTIN</Label>
              <Input id="cv-gstin" value={form.gstin} onChange={set("gstin")} placeholder="Rarely available" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cv-city">City</Label>
              <Input id="cv-city" value={form.city} onChange={set("city")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cv-address">Address</Label>
            <Input id="cv-address" value={form.address} onChange={set("address")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cv-cats">Categories (comma separated)</Label>
            <Input id="cv-cats" value={form.categories} onChange={set("categories")} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={saving || !form.name.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Add Supplier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
