// ─────────────────────────────────────────────────────────────────────────
// PR Procurement-Verification — signature registry
//
// Used by the PR Review verification document. When the PR assignee and the
// Design Team Head each tick "I have read and agree", their signature image is
// stamped onto the document.
//
// HOW TO FILL THIS IN (later):
//   1. Drop each signature image into  public/signatures/  (PNG/JPG, ideally a
//      transparent or white background, roughly 400×150px).
//   2. Reference it below as "/signatures/<file>.png".
//   3. For procurement members the key is their LOGIN EMAIL (lowercase).
//
// Until an entry is filled, the document shows a "signature pending" placeholder
// so the flow is fully testable without the real images.
// ─────────────────────────────────────────────────────────────────────────

export type SignatureEntry = { name: string; signatureUrl: string };

/** The Design Team Head — the second required approver. */
export const DESIGN_TEAM_HEAD: { name: string; email: string; signatureUrl: string } = {
  name: "Sapna Mam",                      // Design Team Head
  email: "",                              // optional — her login email, if she has one
  signatureUrl: "/signatures/sapna.png",  // generated from the provided signature sheet
};

/** Procurement team members, keyed by login email (lowercase). */
export const PROCUREMENT_SIGNATURES: Record<string, SignatureEntry> = {
  "procurement@hagerstone.com": { name: "Avisha",   signatureUrl: "/signatures/avisha.png" },
  "ajitreddy916@gmail.com":     { name: "Ajit",     signatureUrl: "/signatures/ajit.png" },
  "dba88795@gmail.com":         { name: "Deepak B", signatureUrl: "/signatures/deepak.png" },
  // Saksham's signature was not on the provided sheet — add when available:
  // "sakshamkaloya109@gmail.com": { name: "Saksham", signatureUrl: "/signatures/saksham.png" },
};

/** Resolve a procurement member's signature by email (case-insensitive). */
export function getProcurementSignature(email?: string | null): SignatureEntry | null {
  if (!email) return null;
  return PROCUREMENT_SIGNATURES[email.trim().toLowerCase()] ?? null;
}

/**
 * Projects that REQUIRE the Design Team Head sign-off. Every OTHER project is
 * procurement-only (procurement acknowledgement alone unlocks the RFQ).
 *
 * Matched case-insensitively as a substring against the PR's project_code (which
 * holds the project NAME) and project_site. The in-scope projects are:
 *   • Hero Homes — "Hero Home's MU - Greater Noida" only
 *     (NOT "Hero Homes Realty" — procurement-only)
 *   • Bhuj / Dee Development — "Dee Development Engineers LTD - Admin" + "- Canteen"
 *     (NOT "Dee Foundation", which is a different Faridabad project)
 *   • Vaneet Infra, Koko Town, Sael Aerocity
 */
export const DESIGN_REQUIRED_SITE_KEYWORDS = [
  "Hero Home",        // Hero Home's MU — see exclusions below for Hero Homes Realty
  "Dee Development",  // Dee Development Engineers (Bhuj) — excludes "Dee Foundation"
  "Bhuj",             // Bhuj / Dee Piping site references
  "Vaneet",           // Vaneet Infra
  "Koko",             // Koko Town
  "Sael",             // Sael Aerocity
];

/** Projects that match a keyword above but are explicitly procurement-only. Checked first. */
export const DESIGN_EXCLUDED_SITE_KEYWORDS = [
  "Hero Homes Realty",
];

/** True when this PR's project needs the Design Team Head sign-off (in addition to procurement). */
export function isDesignRequiredSite(projectSite?: string | null, projectCode?: string | null): boolean {
  const hay = `${projectSite ?? ""} ${projectCode ?? ""}`.toLowerCase();
  if (DESIGN_EXCLUDED_SITE_KEYWORDS.some((k) => hay.includes(k.toLowerCase()))) return false;
  return DESIGN_REQUIRED_SITE_KEYWORDS.some((k) => hay.includes(k.toLowerCase()));
}
