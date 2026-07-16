// Shared file→Claude-content-block encoding for every document-parse flow.
//
// Anthropic's vision API rejects an image (HTTP 400) when it is larger than 5 MB
// or has a side longer than 8000 px, and internally downsamples anything whose
// long edge exceeds ~1568 px regardless. Phone-camera photos of paper bills
// routinely blow past those limits (3–8 MB, 4000 px+). Sending them raw also
// paid for 4–8× the input tokens the model could actually use — image tokens
// scale with pixel area, and everything past 1568 px was being thrown away
// server-side after we paid to upload it.
//
// So: every image is downscaled to a safe long edge and re-encoded as JPEG
// before sending. The raw photo then always goes through, OCR is sharper, and
// token cost drops sharply (a 4000 px photo → 1568 px ≈ 85% fewer image tokens).
// PDFs are passed through as-is (page selection is a separate, future step).
//
// History: this downscaler was proven in LegacyQuoteUploadModal for months; it
// was promoted here (2026-07-16, cost reduction) so all parse flows share it.

const MAX_IMAGE_EDGE = 1568;

/** Raw base64 of a file/blob, no transformation. Use only for PDFs. */
export const fileToBase64 = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

/** Downscale an image to ≤1568 px long edge and re-encode as JPEG (q=0.85). */
export const downscaleImageToJpegBase64 = (
  file: Blob
): Promise<{ data: string; mediaType: "image/jpeg" }> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const longEdge = Math.max(img.width, img.height);
      const scale = longEdge > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longEdge : 1;
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not supported in this browser"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      // 0.85 quality keeps printed/handwritten text crisp while staying well
      // under the 5 MB limit for a 1568 px JPEG.
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve({ data: dataUrl.split(",")[1], mediaType: "image/jpeg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image — try a JPEG/PNG screenshot"));
    };
    img.src = url;
  });

/** Anthropic content block for one uploaded file/blob: PDF → document (as-is),
 *  anything else → downscaled JPEG image block. */
export const fileToClaudeBlock = async (file: Blob) => {
  if (file.type === "application/pdf") {
    const base64 = await fileToBase64(file);
    return {
      type: "document" as const,
      source: { type: "base64" as const, media_type: "application/pdf", data: base64 },
    };
  }
  const { data, mediaType } = await downscaleImageToJpegBase64(file);
  return {
    type: "image" as const,
    source: { type: "base64" as const, media_type: mediaType, data },
  };
};
