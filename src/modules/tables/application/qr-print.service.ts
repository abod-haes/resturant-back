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
    <text x="50%" y="49" text-anchor="middle" font-family="Cairo, DejaVu Sans, Noto Sans Arabic, sans-serif"
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
    if (items.length === 1) {
      await this.renderSingle(pdf, items[0]!);
      return Buffer.from(await pdf.save());
    }
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
          y: y + 71, width: imageSize, height: imageSize });

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

  /** A dedicated A6 portrait card, with a four-module QR quiet zone. */
  private async renderSingle(pdf: PDFDocument, item: PrintQrItem): Promise<void> {
    const page = pdf.addPage([297.64, 419.53]);
    const name = escapeSvgText(item.restaurantName.trim().slice(0, 120) || "مطعم");
    const label = escapeSvgText(item.label.trim().slice(0, 100));
    const table = /^\s*طاولة/u.test(item.label) ? label : "طاولة رقم " + label;
    const titleSize = item.restaurantName.length > 28 ? 27 : 43;
    const tableSize = item.label.length > 24 ? 23 : 34;
    // Palette mirrors packages/ui/src/brand-tokens.css (light theme).
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1268" viewBox="0 0 900 1268">
      <defs><clipPath id="card"><rect x="15" y="15" width="870" height="1238" rx="22"/></clipPath></defs>
      <g clip-path="url(#card)">
        <rect width="900" height="1268" fill="#FCF7F5"/>
        <path d="M0 0H305C210 95 65 72 0 170Z" fill="#8B2E3C"/>
        <path d="M0 0H245C170 70 60 53 0 126Z" fill="#68202D"/>
        <path d="M0 1170C270 1300 580 1080 900 1135V1268H0Z" fill="#8B2E3C"/>
        <path d="M0 1200C290 1320 600 1110 900 1165V1268H0Z" fill="#68202D"/>
        <g fill="none" stroke="#8B2E3C" stroke-width="10" stroke-linecap="round">
          <path d="M385 173H515M397 162A53 53 0 0 1 503 162Z" fill="#8B2E3C"/>
          <path d="M440 95Q425 78 442 62M465 95Q450 78 467 62"/>
        </g>
        <g font-family="Cairo, DejaVu Sans, sans-serif" text-anchor="middle" fill="#68202D" font-weight="700">
          <text x="450" y="250" font-size="${titleSize}" direction="rtl">${name}</text>
          <rect x="190" y="280" width="520" height="74" rx="37" fill="#F6E6E8"/>
          <text x="450" y="329" font-size="${tableSize}" direction="rtl">${table}</text>
          <rect x="170" y="425" width="560" height="560" rx="30" fill="#FFFFFF" stroke="#EADDDD" stroke-width="2"/>
          <g fill="none" stroke="#8B2E3C" stroke-width="8" stroke-linecap="round">
            <path d="M135 485V445Q135 390 190 390H235 M665 390H710Q765 390 765 445V485 M135 925V965Q135 1020 190 1020H235 M665 1020H710Q765 1020 765 965V925"/>
          </g>
          <rect x="115" y="1040" width="670" height="104" rx="40" fill="#F6E6E8"/>
          <text x="450" y="1082" font-size="30" direction="rtl">امسح الكود لعرض قائمة الطعام</text>
          <text x="450" y="1121" font-size="30" direction="rtl">واستدعاء الخدمة</text>
        </g>
      </g>
      <rect x="15" y="15" width="870" height="1238" rx="22" fill="none" stroke="#8B2E3C" stroke-width="3"/>
    </svg>`;
    const background = await pdf.embedPng(await sharp(Buffer.from(svg)).png().toBuffer());
    const width = page.getWidth();
    const height = page.getHeight();
    page.drawImage(background, { x: 0, y: 0, width, height });
    const qr = await pdf.embedPng(await QRCode.toBuffer(item.url, {
      type: "png", errorCorrectionLevel: "M", margin: 4, width: 900,
    }));
    const size = width * 530 / 900;
    page.drawImage(qr, { x: (width - size) / 2, y: height - height * 440 / 1268 - size,
      width: size, height: size });
  }
}
