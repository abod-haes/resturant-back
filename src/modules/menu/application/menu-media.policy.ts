import { BadRequestException } from "@nestjs/common";
import type { ProductImageInputDto } from "../presentation/menu.dto";

export function verifyMediaUrls(images: readonly ProductImageInputDto[], allowedOrigins: readonly string[]): void {
  for (const image of images) {
    let url: URL;
    try { url = new URL(image.url); } catch {
      throw new BadRequestException({ code: "MEDIA_ORIGIN_NOT_ALLOWED", message: "Invalid product image URL" });
    }
    // Refer only to immutable public media on explicitly allowed HTTPS CDN origins.
    // Never trust an arbitrary destination, URL credentials, fragments or query-string tokens.
    if (url.protocol !== "https:" || !allowedOrigins.includes(url.origin)
      || url.username || url.password || url.search || url.hash || url.pathname === "/") {
      throw new BadRequestException({ code: "MEDIA_ORIGIN_NOT_ALLOWED", message: "Product image host is not approved" });
    }
  }
}
