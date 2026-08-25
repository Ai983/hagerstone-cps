/**
 * Generates the vendor's tokenised registration link (7-day, single-supplier,
 * revocable — issued by cps_issue_vendor_registration_token). Procurement sends
 * it to a vendor who prefers to fill their own details; the link opens the
 * public /vendor/registration page, which writes only through the edge function.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Link2, Loader2 } from "lucide-react";
import { issueToken } from "@/lib/vendorRegistration";

export default function RegistrationLinkButton({
  supplierId, disabled,
}: { supplierId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await issueToken(supplierId);
      setUrl(`${window.location.origin}/vendor/registration?token=${res.token}`);
      setExpiresAt(res.expires_at);
      setOpen(true);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not create the link");
    } finally { setBusy(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast.success("Link copied"); }
    catch { toast.error("Could not copy — select the link and copy it manually"); }
  };

  return (
    <>
      <Button variant="outline" size="sm" disabled={disabled || busy} onClick={generate}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
        Vendor link
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vendor registration link</DialogTitle>
            <DialogDescription>
              Send this to the vendor. It opens their own registration form, works once, is
              scoped to this one vendor, and expires
              {expiresAt ? ` on ${new Date(expiresAt).toLocaleDateString()}` : " in 7 days"}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={url} className="font-mono text-xs"
                   onFocus={(e) => e.currentTarget.select()} />
            <Button variant="outline" size="icon" onClick={copy} aria-label="Copy link">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
