/**
 * Internal site-visit evidence. Never visible to the vendor and never part of
 * the token form.
 *
 * D8: the premises photo needs a location and can NEVER be waived — but per the
 * 2026-08-11 revision it may be sourced third-party rather than captured on
 * site, so both capture modes are offered and geo_source records which.
 * D9: the photo with the vendor is the only item implying an actual visit, and
 * it IS waivable with a written reason.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Eye, MapPin, Upload } from "lucide-react";
import { openSignedFile } from "@/lib/storageUrl";
import {
  type SupplierDocument, DOCUMENT_LABELS, VENDOR_DOC_BUCKET,
  fetchDocuments, requestWaiver, setDocumentGeo, uploadDocument,
} from "@/lib/vendorRegistration";

export default function RegistrationDiligence({
  supplierId, onChanged, disabled,
}: { supplierId: string; onChanged: () => void; disabled?: boolean }) {
  const { user } = useAuth();
  const [docs, setDocs] = useState<SupplierDocument[]>([]);
  const [geoOpen, setGeoOpen] = useState(false);
  const [geoNote, setGeoNote] = useState("");
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [waiverOpen, setWaiverOpen] = useState(false);
  const [waiverReason, setWaiverReason] = useState("");

  const load = useCallback(async () => {
    try { setDocs(await fetchDocuments(supplierId)); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not load evidence"); }
  }, [supplierId]);
  useEffect(() => { void load(); }, [load]);

  const premises = docs.find((d) => d.document_type === "premises_photo");
  const withVendor = docs.find((d) => d.document_type === "photo_with_vendor");

  const upload = async (documentType: string, file: File) => {
    try {
      await uploadDocument({ supplierId, documentType, file, userId: user?.id ?? null });
      await load(); onChanged();
      if (documentType === "premises_photo")
        toast.message("Attached — it still needs a location before it counts");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  };

  const captureOnSite = () => {
    if (!premises) { toast.error("Attach the premises photo first"); return; }
    if (!navigator.geolocation) { toast.error("This device cannot capture a location"); return; }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await setDocumentGeo(premises.id, pos.coords.latitude, pos.coords.longitude, "on_site", null);
          await load(); onChanged();
          toast.success("Location captured on site");
        } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not save the location"); }
      },
      () => toast.error("Location permission refused — use 'Enter location' instead"),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const saveManualGeo = async () => {
    if (!premises) return;
    const lat = Number(manualLat), lng = Number(manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) {
      toast.error("Enter a valid latitude and longitude"); return;
    }
    if (!geoNote.trim()) { toast.error("Say where this location came from"); return; }
    try {
      await setDocumentGeo(premises.id, lat, lng, "third_party", geoNote.trim());
      setGeoOpen(false); setGeoNote(""); setManualLat(""); setManualLng("");
      await load(); onChanged();
      toast.success("Location recorded");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not save the location"); }
  };

  const submitWaiver = async () => {
    if (!waiverReason.trim()) { toast.error("A written reason is required"); return; }
    try {
      await requestWaiver(supplierId, "photo_with_vendor", waiverReason);
      setWaiverOpen(false); setWaiverReason("");
      await load(); onChanged();
      toast.success("Waiver requested — the verifier decides");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Could not request the waiver"); }
  };

  const FileBtn = ({ type }: { type: string }) => (
    <label>
      <Input type="file" accept="image/*" className="hidden" disabled={disabled}
             onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(type, f); e.target.value = ""; }} />
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border
                       text-xs font-medium cursor-pointer hover:bg-muted/40">
        <Upload className="h-3.5 w-3.5" />Attach
      </span>
    </label>
  );

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Site visit evidence — internal
        </h2>
        <p className="text-xs text-muted-foreground -mt-2">
          Never shown to the vendor and never part of the vendor's link.
        </p>

        {/* premises photo */}
        <div className="border border-border rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground">{DOCUMENT_LABELS.premises_photo}</div>
              <div className="text-xs text-muted-foreground">
                {!premises?.file_url ? "Mandatory — cannot be waived"
                  : premises.geo_lat == null ? "Attached, but no location yet"
                  : `${premises.geo_lat}, ${premises.geo_lng} · ${premises.geo_source === "on_site" ? "captured on site" : `third-party — ${premises.geo_note ?? ""}`}`}
              </div>
            </div>
            {premises?.file_url && (
              <Button variant="ghost" size="sm"
                      onClick={() => openSignedFile(premises.file_url, {
                        bucket: VENDOR_DOC_BUCKET, onError: toast.error })}>
                <Eye className="h-4 w-4" />
              </Button>
            )}
            {premises?.geo_lat != null && <Badge>Attached + located</Badge>}
            {!disabled && !premises?.file_url && <FileBtn type="premises_photo" />}
          </div>
          {!disabled && premises?.file_url && premises.geo_lat == null && (
            <div className="flex gap-2">
              <Button size="sm" onClick={captureOnSite}>
                <MapPin className="h-3.5 w-3.5 mr-1" />Capture here
              </Button>
              <Button size="sm" variant="outline" onClick={() => setGeoOpen(true)}>Enter location</Button>
            </div>
          )}
        </div>

        {/* photo with vendor */}
        <div className="border border-border rounded-lg p-3 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">{DOCUMENT_LABELS.photo_with_vendor}</div>
            <div className="text-xs text-muted-foreground">
              {withVendor?.waiver_reason ? `Waiver requested — ${withVendor.waiver_reason}`
                : withVendor?.file_url ? "Attached" : "Mandatory — waivable with a written reason"}
            </div>
          </div>
          {withVendor?.file_url && (
            <Button variant="ghost" size="sm"
                    onClick={() => openSignedFile(withVendor.file_url, {
                      bucket: VENDOR_DOC_BUCKET, onError: toast.error })}>
              <Eye className="h-4 w-4" />
            </Button>
          )}
          {!disabled && !withVendor && (
            <div className="flex gap-2">
              <FileBtn type="photo_with_vendor" />
              <Button variant="ghost" size="sm" onClick={() => setWaiverOpen(true)}>Waiver</Button>
            </div>
          )}
        </div>
      </CardContent>

      <Dialog open={geoOpen} onOpenChange={setGeoOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Enter the premises location</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Latitude, e.g. 28.5355" value={manualLat}
                   onChange={(e) => setManualLat(e.target.value)} className="font-mono" />
            <Input placeholder="Longitude, e.g. 77.3910" value={manualLng}
                   onChange={(e) => setManualLng(e.target.value)} className="font-mono" />
          </div>
          <Textarea rows={2} value={geoNote} placeholder="Where did this location come from?"
                    onChange={(e) => setGeoNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setGeoOpen(false)}>Cancel</Button>
            <Button onClick={saveManualGeo}>Save location</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={waiverOpen} onOpenChange={setWaiverOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Waive the photo with the vendor</DialogTitle></DialogHeader>
          <Textarea rows={3} value={waiverReason} placeholder="Why is a visit not possible?"
                    onChange={(e) => setWaiverReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaiverOpen(false)}>Cancel</Button>
            <Button onClick={submitWaiver}>Request waiver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
