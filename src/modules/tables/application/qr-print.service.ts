import { Injectable } from "@nestjs/common";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import sharp from "sharp";

export interface PrintQrItem { id: string; label: string; url: string; restaurantName: string }

/**
 * Rasterizing text through SVG lets Sharp/Pango handle Arabic shaping without
 * adding an unlicensed or environment-specific PDF font to the repository.
 * All dynamic content is XML-escaped before embedding in the SVG.
 */
function escapeSvgText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function labelImage(value: string, width: number, fontSize: number): Promise<Buffer> {
  const text = escapeSvgText(value.trim().slice(0, 120));
  const isRtl = /[\u0590-\u08ff]/u.test(value);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="78">
    <rect width="100%" height="100%" fill="white"/>
    <text x="50%" y="49" text-anchor="middle" font-family="DejaVu Sans, Noto Sans Arabic, sans-serif"
      font-size="${fontSize}" font-weight="600" fill="#243039"
      direction="${isRtl ? "rtl" : "ltr"}" unicode-bidi="plaintext">${text}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A4, six print-ready stickers per page; QR encodes the existing table URL. */
@Injectable()
export class QrPrintService {
  async render(items: readonly PrintQrItem[]): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    pdf.setTitle("Restaurant table QR labels");
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const width = 595.28;
    const height = 841.89;
    const margin = 29;
    const cellWidth = (width - 2 * margin) / 2;
    const cellHeight = (height - 2 * margin) / 3;
    for (let start = 0; start < items.length || (start === 0 && items.length === 0); start += 6) {
      const page = pdf.addPage([width, height]);
      for (const [offset, item] of items.slice(start, start + 6).entries()) {
        const col = offset % 2;
        const row = Math.floor(offset / 2);
        const x = margin + col * cellWidth;
        const y = height - margin - (row + 1) * cellHeight;
        page.drawRectangle({ x: x + 6, y: y + 6, width: cellWidth - 12,
          height: cellHeight - 12, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
        const png = await QRCode.toBuffer(item.url, { type: "png", errorCorrectionLevel: "M",
          margin: 2, width: 450 });
        const qr = await pdf.embedPng(png);
        const imageSize = Math.min(181, cellWidth - 40);
        page.drawImage(qr, { x: x + (cellWidth - imageSize) / 2,
          y: y + 62, width: imageSize, height: imageSize });

        const restaurantName = item.restaurantName.trim() || "Restaurant";
        const titlePng = await pdf.embedPng(await labelImage(restaurantName, 620, 35));
        const tablePng = await pdf.embedPng(await labelImage(item.label, 620, 28));
        const textWidth = cellWidth - 32;
        page.drawImage(titlePng, { x: x + 16, y: y + 40, width: textWidth, height: 27 });
        page.drawImage(tablePng, { x: x + 16, y: y + 16, width: textWidth, height: 24 });

        // Keep an accessible ASCII identifier in PDF metadata/text streams.
        const identifier = item.id.slice(0, 8);
        page.drawText(identifier, { x: x + 11, y: y + 9, size: 5,
          font, color: rgb(0.5, 0.5, 0.5) });
      }
    }
    return Buffer.from(await pdf.save());
  }
}
