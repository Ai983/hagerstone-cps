/**
 * Opens the vendor's printable form in a new tab. The user prints or saves as
 * PDF from there — the browser's print pipeline is what renders Devanagari
 * correctly, which is the whole reason this is HTML and not jsPDF.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2 } from "lucide-react";
import { type VendorType, fetchDocRules, fetchTerms } from "@/lib/vendorRegistration";
import { renderOnboardingFormHtml } from "@/lib/vendorOnboardingForm";

export default function OfflineFormButton({
  vendorName, vendorType,
}: { vendorName: string; vendorType: VendorType }) {
  const [busy, setBusy] = useState(false);

  const open = async () => {
    // Opened synchronously — browsers block window.open once an await has
    // yielded, the same reason openSignedFile opens its tab first.
    const win = window.open("", "_blank");
    setBusy(true);
    try {
      const [rules, terms] = await Promise.all([fetchDocRules(vendorType), fetchTerms()]);
      const html = renderOnboardingFormHtml({
        mode: "vendor", vendorName, vendorType, rules,
        termsText: terms.text, termsVersion: terms.version,
      });
      if (win) { win.document.write(html); win.document.close(); }
      else toast.error("Allow pop-ups to open the form");
    } catch (e: unknown) {
      win?.close();
      toast.error(e instanceof Error ? e.message : "Could not build the form");
    } finally { setBusy(false); }
  };

  return (
    <Button variant="outline" size="sm" onClick={open} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
      Offline form
    </Button>
  );
}
