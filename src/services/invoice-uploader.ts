import { supabase } from "@/integrations/supabase/client";
import type { ParsedInvoice } from "./invoice-parser";

export type LineMaterialChoice =
  | { kind: "auto" }
  | { kind: "existing"; materialId: string }
  | { kind: "new" };

export interface UploadResult {
  vendorId: string;
  vendorName: string;
  isNewVendor: boolean;
  invoiceId: string;
  invoiceNumber: string;
  lineItemCount: number;
  materialMatches: { description: string; matchedTo: string; isNew: boolean }[];
  benchmarksAdded: number;
  errors: string[];
}

async function resolveMaterialForLine(
  item: ParsedInvoice["line_items"][0],
  choice: LineMaterialChoice,
  materialMatches: UploadResult["materialMatches"],
  errors: string[],
): Promise<{ materialId: string; matchedName: string; isNewMaterial: boolean }> {
  const normalised = item.description.toUpperCase().trim();

  if (choice.kind === "existing") {
    const { data: row } = await supabase
      .from("materials")
      .select("id, canonical_name")
      .eq("id", choice.materialId)
      .maybeSingle();
    const name = row?.canonical_name ?? choice.materialId;
    materialMatches.push({ description: item.description, matchedTo: name, isNew: false });
    return { materialId: choice.materialId, matchedName: name, isNewMaterial: false };
  }

  if (choice.kind === "new") {
    const { data: newMaterial, error } = await supabase
      .from("materials")
      .insert({ canonical_name: normalised })
      .select("id")
      .single();
    if (error) throw new Error(`Failed to create material: ${error.message}`);
    const materialId = newMaterial.id;
    const { error: itemError } = await supabase.from("cps_items").insert({
      material_id: materialId,
      name: normalised,
      unit: item.unit,
      hsn_code: item.hsn_sac,
      last_purchase_rate: item.rate,
      active: true,
    });
    if (itemError) {
      errors.push(`Warning: cps_items insert failed for "${normalised}": ${itemError.message}`);
    }
    materialMatches.push({ description: item.description, matchedTo: normalised, isNew: true });
    return { materialId, matchedName: normalised, isNewMaterial: true };
  }

  let { data: material } = await supabase
    .from("materials")
    .select("id, canonical_name")
    .ilike("canonical_name", normalised)
    .maybeSingle();

  if (!material) {
    const words = normalised.split(/\s+/).filter(Boolean).slice(0, 3);
    const pattern = words.length ? `%${words.join("%")}%` : `%${normalised}%`;
    const { data: partialMatches } = await supabase
      .from("materials")
      .select("id, canonical_name")
      .ilike("canonical_name", pattern)
      .limit(1);
    if (partialMatches?.length) material = partialMatches[0];
  }

  if (material) {
    materialMatches.push({
      description: item.description,
      matchedTo: material.canonical_name,
      isNew: false,
    });
    return { materialId: material.id, matchedName: material.canonical_name, isNewMaterial: false };
  }

  const { data: newMaterial, error } = await supabase
    .from("materials")
    .insert({ canonical_name: normalised })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create material: ${error.message}`);
  const materialId = newMaterial.id;
  const { error: itemError } = await supabase.from("cps_items").insert({
    material_id: materialId,
    name: normalised,
    unit: item.unit,
    hsn_code: item.hsn_sac,
    last_purchase_rate: item.rate,
    active: true,
  });
  if (itemError) {
    errors.push(`Warning: cps_items insert failed for "${normalised}": ${itemError.message}`);
  }
  materialMatches.push({ description: item.description, matchedTo: normalised, isNew: true });
  return { materialId, matchedName: normalised, isNewMaterial: true };
}

export async function uploadParsedInvoice(
  parsed: ParsedInvoice,
  googleDriveFileId: string,
  originalFileName: string,
  lineChoices?: LineMaterialChoice[],
): Promise<UploadResult> {
  const errors: string[] = [];
  const materialMatches: UploadResult["materialMatches"] = [];
  let benchmarksAdded = 0;

  let vendorId: string;
  let isNewVendor = false;

  if (parsed.vendor.gstin) {
    const { data: existing } = await supabase
      .from("vendors")
      .select("id")
      .eq("gstin", parsed.vendor.gstin)
      .maybeSingle();

    if (existing) {
      vendorId = existing.id;
    } else {
      const { data: newVendor, error } = await supabase
        .from("vendors")
        .insert({
          name: parsed.vendor.name.toUpperCase(),
          gstin: parsed.vendor.gstin,
          phone: parsed.vendor.phone,
          email: parsed.vendor.email,
          address_text: parsed.vendor.address,
          city: parsed.vendor.city,
          state: parsed.vendor.state,
          pincode: parsed.vendor.pincode,
        })
        .select("id")
        .single();

      if (error) throw new Error(`Failed to create vendor: ${error.message}`);
      vendorId = newVendor.id;
      isNewVendor = true;
    }
  } else {
    const upperName = parsed.vendor.name.toUpperCase();
    const { data: existing } = await supabase
      .from("vendors")
      .select("id")
      .ilike("name", upperName)
      .maybeSingle();

    if (existing) {
      vendorId = existing.id;
    } else {
      const { data: newVendor, error } = await supabase
        .from("vendors")
        .insert({
          name: upperName,
          phone: parsed.vendor.phone,
          email: parsed.vendor.email,
          address_text: parsed.vendor.address,
          city: parsed.vendor.city,
          state: parsed.vendor.state,
          pincode: parsed.vendor.pincode,
        })
        .select("id")
        .single();

      if (error) throw new Error(`Failed to create vendor: ${error.message}`);
      vendorId = newVendor.id;
      isNewVendor = true;
    }
  }

  if (isNewVendor) {
    const { error } = await supabase.from("cps_suppliers").insert({
      vendor_id: vendorId,
      name: parsed.vendor.name.toUpperCase(),
      gstin: parsed.vendor.gstin,
      email: parsed.vendor.email,
      phone: parsed.vendor.phone,
      address_text: parsed.vendor.address,
      city: parsed.vendor.city,
      state: parsed.vendor.state,
      pincode: parsed.vendor.pincode,
      categories: [],
      regions: [],
      status: "active",
      is_test: false,
    });
    if (error) errors.push(`Warning: cps_suppliers insert failed: ${error.message}`);
  } else {
    const { data: existingSupplier } = await supabase
      .from("cps_suppliers")
      .select("id")
      .eq("vendor_id", vendorId)
      .maybeSingle();

    if (!existingSupplier) {
      const { error } = await supabase.from("cps_suppliers").insert({
        vendor_id: vendorId,
        name: parsed.vendor.name.toUpperCase(),
        gstin: parsed.vendor.gstin,
        email: parsed.vendor.email,
        phone: parsed.vendor.phone,
        city: parsed.vendor.city,
        state: parsed.vendor.state,
        status: "active",
        is_test: false,
      });
      if (error) errors.push(`Warning: cps_suppliers insert failed: ${error.message}`);
    }
  }

  const filePath = `gdrive://${googleDriveFileId}`;
  const { data: existingInvoice } = await supabase
    .from("invoices")
    .select("id")
    .eq("file_path", filePath)
    .maybeSingle();

  if (existingInvoice) {
    throw new Error(`Invoice already imported (file: ${originalFileName})`);
  }

  const lineItemsWithMaterialId: Array<{
    material_id: string;
    original: ParsedInvoice["line_items"][0];
    isNewMaterial: boolean;
    matchedName: string;
  }> = [];

  for (let i = 0; i < parsed.line_items.length; i++) {
    const item = parsed.line_items[i];
    const choice: LineMaterialChoice = lineChoices?.[i] ?? { kind: "auto" };
    const resolved = await resolveMaterialForLine(item, choice, materialMatches, errors);
    lineItemsWithMaterialId.push({
      material_id: resolved.materialId,
      original: item,
      isNewMaterial: resolved.isNewMaterial,
      matchedName: resolved.matchedName,
    });
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert({
      vendor_id: vendorId,
      invoice_number: parsed.invoice.invoice_number,
      invoice_date: parsed.invoice.invoice_date,
      total_amount: parsed.invoice.total_amount,
      file_path: filePath,
      document_type: parsed.invoice.document_type,
      project_name: parsed.invoice.project_name,
      source_file: originalFileName,
      extraction_confidence: parsed.confidence,
      needs_review: parsed.confidence < 70,
      extraction_warnings: parsed.warnings,
      extracted_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (invoiceError) throw new Error(`Failed to insert invoice: ${invoiceError.message}`);

  const lineItemRows = lineItemsWithMaterialId.map((li) => ({
    invoice_id: invoice.id,
    vendor_id: vendorId,
    material_id: li.material_id,
    original_description: li.original.description,
    quantity: li.original.quantity,
    unit: li.original.unit,
    rate: li.original.rate,
    tax_percent: li.original.tax_percent,
    taxable_value: li.original.taxable_value,
    hsn_sac: li.original.hsn_sac,
    line_total: li.original.line_total,
    item_type: li.original.item_type,
    invoice_date: parsed.invoice.invoice_date,
  }));

  const { error: lineError } = await supabase.from("invoice_line_items").insert(lineItemRows);
  if (lineError) {
    errors.push(`Line items insert error: ${lineError.message}`);
  }

  for (const li of lineItemsWithMaterialId) {
    if (li.original.item_type !== "material") continue;
    if (!li.original.rate || li.original.rate <= 0) continue;

    const { data: cpsItem } = await supabase
      .from("cps_items")
      .select("id")
      .eq("material_id", li.material_id)
      .maybeSingle();

    if (cpsItem) {
      const { error: benchError } = await supabase.from("cps_benchmarks").insert({
        item_id: cpsItem.id,
        item_description: li.original.description,
        region: parsed.vendor.state || "Unknown",
        source: "internal",
        rate: li.original.rate,
        confidence_level: parsed.confidence >= 80 ? "high" : parsed.confidence >= 50 ? "medium" : "low",
      });
      if (benchError) {
        errors.push(`Benchmark insert warning: ${benchError.message}`);
      } else {
        benchmarksAdded += 1;
      }

      await supabase.from("cps_items").update({ last_purchase_rate: li.original.rate }).eq("id", cpsItem.id);
    }
  }

  return {
    vendorId,
    vendorName: parsed.vendor.name,
    isNewVendor,
    invoiceId: invoice.id,
    invoiceNumber: parsed.invoice.invoice_number,
    lineItemCount: parsed.line_items.length,
    materialMatches,
    benchmarksAdded,
    errors,
  };
}
