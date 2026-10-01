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

/**
 * Design Team Head sign-off switch. OFF since 2026-10-01: the previous Design
 * Team Head left and the post is vacant, so every PR is procurement-only and
 * procurement's acknowledgement alone verifies it. When a new Design Team Head
 * joins: fill in DESIGN_TEAM_HEAD below, drop their signature image into
 * public/signatures/, and flip this back to true.
 */
export const DESIGN_SIGNOFF_ENABLED = false;

/** The Design Team Head — the second required approver (vacant). */
export const DESIGN_TEAM_HEAD: { name: string; email: string; signatureUrl: string } = {
  name: "Design Team Head",               // vacant — set the new head's name here
  email: "",
  signatureUrl: "",                       // vacant — e.g. "/signatures/<name>.png"
};

/** Procurement team members, keyed by login email (lowercase). */
export const PROCUREMENT_SIGNATURES: Record<string, SignatureEntry> = {
  "procurement@hagerstone.com": { name: "Avisha",   signatureUrl: "/signatures/avisha.png" },
  "ajitreddy916@gmail.com":     { name: "Ajit",     signatureUrl: "/signatures/ajit.png" },
  "dba88795@gmail.com":         { name: "Deepak B", signatureUrl: "/signatures/deepak.png" },
  // Saksham's signature was not on the provided sheet — add when available:
  // "sakshamkaloya109@gmail.com": { name: "Saksham", signatureUrl: "/signatures/saksham.png" },
  // Vishal Jain (Procurement Manager) — signature image to be supplied. Until the
  // file is dropped into public/signatures/ and this line uncommented, his
  // acknowledgement stamps the "signature pending" placeholder, which is fine.
  // "vishalj665@gmail.com":       { name: "Vishal Jain", signatureUrl: "/signatures/vishal.png" },
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
  if (!DESIGN_SIGNOFF_ENABLED) return false;
  const hay = `${projectSite ?? ""} ${projectCode ?? ""}`.toLowerCase();
  if (DESIGN_EXCLUDED_SITE_KEYWORDS.some((k) => hay.includes(k.toLowerCase()))) return false;
  return DESIGN_REQUIRED_SITE_KEYWORDS.some((k) => hay.includes(k.toLowerCase()));
}
