import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Trash2, Edit2, Package } from "lucide-react";

type ItemMaster = { id: string; name: string; unit: string | null; category: string | null };
type BoqRow = {
  id: string;
  project_code: string;
  item_id: string;
  item_description: string | null;
  unit: string | null;
  planned_quantity: number;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export default function ProjectBOQ() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<string[]>([]);
  const [items, setItems] = useState<ItemMaster[]>([]);
  const [boqRows, setBoqRows] = useState<BoqRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectCode, setProjectCode] = useState<string>("");
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<BoqRow | null>(null);
  const [formItemId, setFormItemId] = useState<string>("");
  const [formQty, setFormQty] = useState<string>("");
  const [formNotes, setFormNotes] = useState<string>("");
  const [itemSearch, setItemSearch] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadProjects();
    void loadItems();
  }, []);

  useEffect(() => {
    if (projectCode) void loadBoq(projectCode);
    else setBoqRows([]);
  }, [projectCode]);

  const loadProjects = async () => {
    const { data } = await supabase
      .from("cps_purchase_requisitions")
      .select("project_code")
      .neq("project_code", null);
    const unique = Array.from(new Set(((data ?? []) as Array<{ project_code: string | null }>)
      .map((r) => (r.project_code ?? "").trim())
      .filter(Boolean)))
      .sort();
    setProjects(unique);
  };

  const loadItems = async () => {
    const { data } = await supabase
      .from("cps_items")
      .select("id,name,unit,category")
      .eq("active", true)
      .order("name");
    setItems((data ?? []) as ItemMaster[]);
  };

  const loadBoq = async (code: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("cps_project_boqs")
      .select("id,project_code,item_id,item_description,unit,planned_quantity,notes,created_at,updated_at")
      .eq("project_code", code)
      .order("item_description", { ascending: true });
    if (error) toast.error(error.message);
    setBoqRows((data ?? []) as BoqRow[]);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boqRows;
    return boqRows.filter((r) =>
      (r.item_description ?? "").toLowerCase().includes(q)
      || (r.notes ?? "").toLowerCase().includes(q));
  }, [boqRows, search]);

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return items.slice(0, 100);
    return items.filter((i) => i.name.toLowerCase().includes(q)
      || (i.category ?? "").toLowerCase().includes(q)).slice(0, 200);
  }, [items, itemSearch]);

  const itemsById = useMemo(() => {
    const m = new Map<string, ItemMaster>();
    items.forEach((i) => m.set(i.id, i));
    return m;
  }, [items]);

  const openAdd = () => {
    setEditingRow(null);
    setFormItemId("");
    setFormQty("");
    setFormNotes("");
    setItemSearch("");
    setDialogOpen(true);
  };

  const openEdit = (row: BoqRow) => {
    setEditingRow(row);
    setFormItemId(row.item_id);
    setFormQty(String(row.planned_quantity));
    setFormNotes(row.notes ?? "");
    setItemSearch("");
    setDialogOpen(true);
  };

  const save = async () => {
    if (!user || !projectCode) return;
    if (!formItemId) { toast.error("Select an item"); return; }
    const qty = parseFloat(formQty);
    if (!Number.isFinite(qty) || qty < 0) { toast.error("Enter a valid quantity"); return; }

    const item = itemsById.get(formItemId);
    if (!item) { toast.error("Item not found"); return; }

    setSaving(true);
    try {
      if (editingRow) {
        const { error } = await supabase
          .from("cps_project_boqs")
          .update({
            planned_quantity: qty,
            notes: formNotes.trim() || null,
            item_description: item.name,
            unit: item.unit,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", editingRow.id);
        if (error) throw error;
        toast.success("BOQ item updated");
      } else {
        const { error } = await supabase.from("cps_project_boqs").insert({
          project_code: projectCode,
          item_id: formItemId,
          item_description: item.name,
          unit: item.unit,
          planned_quantity: qty,
          notes: formNotes.trim() || null,
          created_by: user.id,
        } as any);
        if (error) {
          if (error.code === "23505") toast.error("This item is already in the BOQ for this project");
          else throw error;
          return;
        }
        toast.success("Added to BOQ");
      }
      setDialogOpen(false);
      await loadBoq(projectCode);
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: BoqRow) => {
    if (!confirm(`Remove "${row.item_description}" from BOQ?`)) return;
    const { error } = await supabase.from("cps_project_boqs").delete().eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Removed from BOQ");
    await loadBoq(projectCode);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Project BOQ</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define the Bill of Quantities for each project — the site team uses this list when updating stock.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={projectCode} onValueChange={setProjectCode}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Select a project…" /></SelectTrigger>
          <SelectContent>
            {projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search BOQ items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            disabled={!projectCode}
          />
        </div>

        <Button onClick={openAdd} disabled={!projectCode}>
          <Plus className="h-4 w-4 mr-1.5" /> Add Item to BOQ
        </Button>
      </div>

      {!projectCode ? (
        <Card>
          <CardContent className="py-14 text-center space-y-3">
            <Package className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">Pick a project to view or edit its BOQ</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Planned Qty</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <>
                    {[1, 2, 3].map((i) => (
                      <TableRow key={i}>
                        {[1, 2, 3, 4, 5].map((j) => <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>)}
                      </TableRow>
                    ))}
                  </>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                      {boqRows.length === 0 ? "No BOQ items yet for this project" : "No items match your search"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.item_description ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{r.unit ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{Number(r.planned_quantity).toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-muted-foreground text-xs max-w-xs truncate">{r.notes ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(r)} title="Edit">
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => remove(r)} title="Remove" className="text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {boqRows.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-2">{boqRows.length}</Badge>
          BOQ items defined for <span className="font-semibold text-foreground">{projectCode}</span>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRow ? "Edit BOQ Item" : "Add Item to BOQ"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {!editingRow && (
              <div className="space-y-1">
                <Label className="text-xs">Item</Label>
                <Input
                  placeholder="Search items…"
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                />
                <div className="border rounded-md max-h-48 overflow-y-auto">
                  {filteredItems.map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => { setFormItemId(i.id); setItemSearch(i.name); }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50 ${formItemId === i.id ? "bg-primary/10" : ""}`}
                    >
                      <span className="font-medium">{i.name}</span>
                      {i.unit && <span className="text-muted-foreground"> · {i.unit}</span>}
                      {i.category && <span className="text-xs text-muted-foreground block">{i.category}</span>}
                    </button>
                  ))}
                  {filteredItems.length === 0 && (
                    <p className="text-xs text-muted-foreground px-3 py-2">No items match</p>
                  )}
                </div>
              </div>
            )}

            {editingRow && (
              <div className="rounded-md bg-muted/30 p-2 text-sm">
                <div className="font-medium">{editingRow.item_description}</div>
                <div className="text-xs text-muted-foreground">{editingRow.unit ?? "—"}</div>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Planned Quantity *</Label>
              <Input type="number" min={0} step="0.01" value={formQty} onChange={(e) => setFormQty(e.target.value)} placeholder="e.g. 100" />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editingRow ? "Update" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
