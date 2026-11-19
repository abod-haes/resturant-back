import { BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from "@nestjs/common";
import sharp from "sharp";
import { basename } from "node:path";
import type { MediaKind } from "../../../database/database.types";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_MEDIA_ASSETS = 1000;
export const MAX_GALLERY_IMAGES = 8;
export interface ProcessedMedia {
  body: Buffer;
  contentType: "image/webp" | "application/pdf";
  kind: MediaKind;
  originalName: string;
  width: number | null;
  height: number | null;
}

export function cleanFilename(value: string): string {
  const clean = basename(value.replaceAll("\\", "/")).replace(/[\x00-\x1f\x7f]/g, "").trim();
  return clean.slice(0, 200) || "upload";
}
export async function processMedia(kind: MediaKind, file?: Express.Multer.File): Promise<ProcessedMedia> {
  if (!file?.buffer?.length) throw new BadRequestException({ code: "MEDIA_FILE_REQUIRED", message: "Select a file to upload" });
  if (file.size > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException({ code: "MEDIA_TOO_LARGE", message: "Maximum upload is 10 MiB" });
  const originalName = cleanFilename(file.originalname);
  if (kind === "document") {
    if (file.mimetype !== "application/pdf" || file.size > MAX_UPLOAD_BYTES
      || !file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new UnsupportedMediaTypeException({ code: "MEDIA_UNSUPPORTED", message: "Only valid PDF documents are accepted" });
    }
    // PDFs remain private, download-only. No public URL, inline rendering or attachment to public menu.
    return { body: file.buffer, kind, originalName, contentType: "application/pdf", width: null, height: null };
  }
  if (file.size > MAX_IMAGE_BYTES) throw new PayloadTooLargeException({ code: "MEDIA_TOO_LARGE", message: "Image exceeds 8 MiB" });
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
    throw new UnsupportedMediaTypeException({ code: "MEDIA_UNSUPPORTED", message: "Only JPEG, PNG or WebP images are accepted" });
  }
  try {
    // Decoding validates actual bytes, not merely user-provided MIME; reject animated images.
    const input = sharp(file.buffer, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false, failOn: "error" });
    const metadata = await input.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "")
      || !metadata.width || !metadata.height || metadata.pages && metadata.pages > 1) {
      throw new Error("Unsupported image");
    }
    const { data, info } = await sharp(file.buffer, {
      limitInputPixels: MAX_IMAGE_PIXELS, animated: false, failOn: "error",
    }).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 }).toBuffer({ resolveWithObject: true });
    if (data.length > MAX_IMAGE_BYTES) throw new PayloadTooLargeException({ code: "MEDIA_TOO_LARGE", message: "Processed image exceeds 8 MiB" });
    return { body: data, kind, originalName, contentType: "image/webp", width: info.width, height: info.height };
  } catch (error: unknown) {
    if (error instanceof PayloadTooLargeException) throw error;
    throw new UnsupportedMediaTypeException({ code: "MEDIA_UNSUPPORTED", message: "Invalid or unsupported image data" });
  }
}
