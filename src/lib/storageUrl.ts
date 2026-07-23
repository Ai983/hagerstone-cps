import { supabase } from "@/integrations/supabase/client";

// `cps-quotes` is a PRIVATE bucket, but several upload sites historically stored a
// `getPublicUrl()` link for it (KanbanBoard/PurchaseRequisitions invoices, legacy
// quotes, BOQ uploads, PR reference images). Supabase only serves `/object/public/`
// for buckets flagged public, so those links fail — and the error it returns is
// misleadingly worded:
//
//   {"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}
//
// The bucket is NOT missing and the file is NOT lost; the bucket simply isn't public.
// So resolve at read time instead: pull the object path back out of whatever was
// stored and mint a short-lived signed URL.
//
// Making the bucket public would "fix" this in one line — and would be wrong. It
// holds vendor quotes and invoices, i.e. pricing, which the blind-quotation rule
// exists to protect. Public means readable by anyone holding the URL, unauthenticated.
//
// Accepts either form, so no data migration is needed and old rows keep working:
//   - a legacy public URL  ".../object/public/cps-quotes/pr-invoices/x.pdf"
//   - a bare object path   "pr-invoices/x.pdf"
//
// This logic originated inline in ComparisonSheet.tsx, which hit the bug first; it
// lives here now so every caller shares one implementation.

const DEFAULT_BUCKET = "cps-quotes";
const DEFAULT_EXPIRY_SECONDS = 3600;

/** Strip a stored value down to the object path within `bucket`. */
export function objectPathFor(storedValue: string, bucket = DEFAULT_BUCKET): string {
  const marker = `/object/public/${bucket}/`;
  const idx = storedValue.indexOf(marker);
  if (idx !== -1) return storedValue.slice(idx + marker.length);
  // Already-signed URLs carry the path too, before the query string.
  const signMarker = `/object/sign/${bucket}/`;
  const sIdx = storedValue.indexOf(signMarker);
  if (sIdx !== -1) return storedValue.slice(sIdx + signMarker.length).split("?")[0];
  return storedValue;
}

/** Resolve a stored path or legacy public URL into a usable signed URL. */
export async function resolveToSignedUrl(
  storedValue: string,
  bucket = DEFAULT_BUCKET,
  expiresIn = DEFAULT_EXPIRY_SECONDS,
): Promise<string | null> {
  const path = objectPathFor(storedValue, bucket);
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

/**
 * Open a stored file in a new tab.
 *
 * The blank tab is opened synchronously inside the click handler — browsers block
 * `window.open` once an await has yielded, so resolving the signed URL first would
 * get the popup swallowed.
 */
export async function openSignedFile(
  storedValue: string | null | undefined,
  opts: { bucket?: string; onError?: (msg: string) => void } = {},
): Promise<void> {
  const { bucket = DEFAULT_BUCKET, onError } = opts;
  if (!storedValue) {
    onError?.("No file on record");
    return;
  }
  const win = window.open("", "_blank");
  const url = await resolveToSignedUrl(storedValue, bucket);
  if (!url) {
    onError?.("Could not open the file");
    win?.close();
    return;
  }
  if (win) win.location.href = url;
  else window.open(url, "_blank");
}
