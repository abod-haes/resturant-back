import sharp from "sharp";
import {
  MAX_GALLERY_IMAGES, MAX_IMAGE_BYTES, cleanFilename, processMedia,
} from "../../src/modules/media/application/media-content";

function upload(buffer: Buffer, mimetype: string, originalname: string): Express.Multer.File {
  return { buffer, mimetype, originalname, size: buffer.length } as Express.Multer.File;
}
describe("Managed media content normalization", () => {
  it("removes metadata and transforms PNG to bounded WebP without enlarging", async () => {
    const png = await sharp({
      create: { width: 20, height: 12, channels: 3, background: "#ffcc00" },
    }).png().toBuffer();
    const media = await processMedia("image", upload(png, "image/png", "folder\\food.png"));
    expect(media.contentType).toBe("image/webp");
    expect(media.width).toBe(20);
    expect(media.height).toBe(12);
    expect(media.originalName).toBe("food.png");
    expect(media.body.length).toBeLessThan(MAX_IMAGE_BYTES);
    const actual = await sharp(media.body).metadata();
    expect(actual.format).toBe("webp");
    expect(actual.exif).toBeUndefined();
    expect(actual.orientation).toBeUndefined();
    expect(MAX_GALLERY_IMAGES).toBe(8);
  });
  it("resizes large pictures to 2000 maximum dimension", async () => {
    const png = await sharp({ create: {
      width: 2400, height: 1200, channels: 3, background: "#005500",
    } }).png().toBuffer();
    const out = await processMedia("image", upload(png, "image/png", "big.png"));
    expect(out.width).toBe(2000);
    expect(out.height).toBe(1000);
  });
  it("rejects SVG, MIME spoofing, empty and oversized images", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>');
    await expect(processMedia("image", upload(svg, "image/svg+xml", "evil.svg"))).rejects.toMatchObject({ status: 415 });
    await expect(processMedia("image", upload(svg, "image/jpeg", "fake.jpg"))).rejects.toMatchObject({ status: 415 });
    await expect(processMedia("image")).rejects.toMatchObject({ status: 400 });
    const huge = upload(Buffer.alloc(8*1024*1024+1), "image/jpeg", "too-big.jpg");
    await expect(processMedia("image", huge)).rejects.toMatchObject({ status: 413 });
  });
  it("keeps valid PDFs private and rejects malformed documents", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
    const valid = await processMedia("document", upload(pdf, "application/pdf", "../private.pdf"));
    expect(valid.contentType).toBe("application/pdf");
    expect(valid.kind).toBe("document");
    expect(valid.originalName).toBe("private.pdf");
    expect(valid.width).toBeNull();
    await expect(processMedia("document", upload(Buffer.from("not-pdf"), "application/pdf", "wrong.pdf")))
      .rejects.toMatchObject({ status: 415 });
    await expect(processMedia("document", upload(pdf, "text/plain", "wrong.txt")))
      .rejects.toMatchObject({ status: 415 });
  });
  it("sanitizes path traversal and control characters in display filenames", () => {
    expect(cleanFilename("../../secret.pdf")).toBe("secret.pdf");
    expect(cleanFilename("path\\photo\u0000.png")).toBe("photo.png");
    expect(cleanFilename("")).toBe("upload");
  });
});
