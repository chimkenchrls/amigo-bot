import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "../constants.js";

export interface AttachmentLike {
  contentType: string | null;
  size: number;
  url: string;
}

export type ImageValidation =
  | { ok: true; mimeType: string }
  | { ok: false; reason: string };

export function validateImage(att: AttachmentLike): ImageValidation {
  const ct = att.contentType?.split(";")[0]?.trim().toLowerCase() ?? null;
  const match = ALLOWED_IMAGE_TYPES.find((t) => t === ct);
  if (!match) return { ok: false, reason: "not-an-image" };
  if (att.size > MAX_IMAGE_BYTES) return { ok: false, reason: "too-large" };
  return { ok: true, mimeType: match };
}

export async function fetchImageAsBase64(
  url: string,
  mimeType: string,
): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { data: buf.toString("base64"), mimeType };
}
