import {
  customerQrUrl, decryptQrToken, encryptQrToken, generateQrToken, hashQrToken, isValidQrToken,
} from "../../src/modules/tables/domain/qr-credential";
import { QrPrintService } from "../../src/modules/tables/application/qr-print.service";
import { PDFDocument } from "pdf-lib";
import { parseRuntimeConfig } from "../../src/common/config/runtime-config";

const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
describe("Table QR token and printing policy", () => {
  it("creates unpredictable 256-bit URL-safe tokens, hashes and stores encrypted, not plaintext", () => {
    const a = generateQrToken();
    const b = generateQrToken();
    expect(isValidQrToken(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(hashQrToken(a)).toHaveLength(64);
    const box = encryptQrToken(a, key);
    expect(box).not.toContain(a);
    expect(decryptQrToken(box, key)).toBe(a);
    expect(() => decryptQrToken(box, "11".repeat(32))).toThrow();
  });
  it("rejects corrupt credentials and constructs the customer app URL without guessing", () => {
    expect(() => decryptQrToken("invalid", key)).toThrow();
    expect(isValidQrToken("test")).toBe(false);
    expect(() => customerQrUrl("https://customer.example.test", "not-a-real-token")).toThrow();
    expect(customerQrUrl("https://customer.example.test", generateQrToken()))
      .toMatch(/^https:\/\/customer\.example\.test\/t\/[\w-]{43}$/);
  });
  it("validates QR configuration without breaking the existing service when optional", () => {
    const basic = {
      NODE_ENV: "test", DATABASE_URL: "postgresql://test:test@localhost:5432/restaurant",
      AUTH_ACCESS_SECRET: "unit-test-signing-secret-must-be-longer-than-32bytes",
    };
    expect(parseRuntimeConfig(basic).qrEncryptionKey).toBe(null);
    expect(parseRuntimeConfig({ ...basic, QR_TOKEN_ENCRYPTION_KEY: key,
      CUSTOMER_APP_ORIGIN: "https://customer.example.test" }).customerAppOrigin)
      .toBe("https://customer.example.test");
    expect(() => parseRuntimeConfig({ ...basic, QR_TOKEN_ENCRYPTION_KEY: "invalid" })).toThrow();
    expect(() => parseRuntimeConfig({ ...basic, CUSTOMER_APP_ORIGIN: "http://example.test" })).toThrow();
    expect(() => parseRuntimeConfig({ ...basic, CUSTOMER_APP_ORIGIN: "https://example.test/menu" })).toThrow();
  });
  it("renders a valid A4 PDF containing one QR per label", async () => {
    const pdf = await new QrPrintService().render([
      { id: "83775fa9-579b-4896-a435-3db54c1b3548", label: "Table 1",
        url: customerQrUrl("https://customer.example.test", generateQrToken()) },
      { id: "c323b57f-5f21-4bee-af62-d688eaed4d21", label: "طاولة عربية",
        url: customerQrUrl("https://customer.example.test", generateQrToken()) },
    ]);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const opened = await PDFDocument.load(pdf);
    expect(opened.getPageCount()).toBe(1);
    expect(opened.getPage(0).getWidth()).toBeGreaterThan(590);
    expect(opened.getPage(0).getHeight()).toBeGreaterThan(840);
  });
});
