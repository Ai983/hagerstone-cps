import { callClaude } from "@/lib/claudeProxy";

export interface SignatureVerifyResult {
  design_signed: boolean;
  procurement_signed: boolean;
  confidence: number; // 0-100
  notes: string;
  /** True only when BOTH required signatures are detected. */
  bothPresent: boolean;
}

const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Uses Claude vision (via the claude-proxy edge function) to check whether the
 * uploaded, scanned PR approval sheet carries BOTH handwritten signatures:
 * the Design Team Head box and the Procurement Team Head box.
 *
 * Synchronous-feeling (awaited) so the caller can block the "move to RFQ" gate
 * until verification passes.
 */
export async function verifyApprovalSheetSignatures(file: File): Promise<SignatureVerifyResult> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error("Only PDF, PNG or JPEG scans are supported");
  }

  const base64 = await fileToBase64(file);

  // PDF → document block; image → image block (Claude supports both shapes).
  const mediaBlock =
    file.type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : {
          type: "image",
          source: { type: "base64", media_type: (file.type === "image/jpg" ? "image/jpeg" : file.type) as "image/png" | "image/jpeg", data: base64 },
        };

  const prompt = `This is a scanned "Purchase Requisition — Site Verification & Approval Sheet".
Near the bottom it has TWO signature boxes side by side:
  - LEFT box titled "DESIGN TEAM HEAD"
  - RIGHT box titled "PROCUREMENT TEAM HEAD"
Each box has Name / Signature / Date lines.

Carefully inspect both boxes and decide whether each one contains an actual handwritten
signature (ink stroke / scribble on the Signature line). A printed name alone, or an empty
line, does NOT count as a signature.

Return ONLY JSON, no prose:
{
  "design_signed": boolean,        // true if the DESIGN TEAM HEAD box has a handwritten signature
  "procurement_signed": boolean,   // true if the PROCUREMENT TEAM HEAD box has a handwritten signature
  "confidence": number,            // 0-100, your confidence in this assessment
  "notes": "short observation, e.g. which box is missing a signature or if scan is unclear"
}`;

  const result = await callClaude({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: [mediaBlock, { type: "text", text: prompt }],
      },
    ],
  });

  const textContent = result.content.find((b) => b.type === "text")?.text || "{}";
  const jsonMatch = textContent.match(/\{[\s\S]*\}/);
  const data = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

  const design_signed = Boolean(data.design_signed);
  const procurement_signed = Boolean(data.procurement_signed);

  return {
    design_signed,
    procurement_signed,
    confidence: typeof data.confidence === "number" ? data.confidence : 0,
    notes: typeof data.notes === "string" ? data.notes : "",
    bothPresent: design_signed && procurement_signed,
  };
}
