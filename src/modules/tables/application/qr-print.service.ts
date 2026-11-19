import { Injectable } from "@nestjs/common";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

export interface PrintQrItem { id: string; label: string; url: string }

/** A4, six print-ready stickers per page; graphic QR carries the full opaque table URL. */
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
          y: y + 48, width: imageSize, height: imageSize });
        // Standard embedded PDF font has no Arabic glyphs. Keep the QR functional,
        // printing an ASCII identifier until the Arabic PDF typography design is integrated.
        const title = /^[\x20-\x7E]+$/.test(item.label) ? item.label.slice(0, 30) : item.id.slice(0, 8);
        page.drawText("TABLE " + title, { x: x + 22, y: y + 27,
          size: 11, font, color: rgb(0.14, 0.17, 0.22), maxWidth: cellWidth - 44 });
      }
    }
    return Buffer.from(await pdf.save());
  }
}
