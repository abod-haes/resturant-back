import { managedImagePath } from "../../src/common/tenancy/managed-image-path";

const origin = "https://images.example.test";
const tenant = "9c5b5fb3-c17b-4c4a-aaf1-95959ebdcc29";
const asset = "bafdfb23-1a8a-4e58-906d-83be2a302f02";
const path = "/r/" + tenant + "/" + asset + ".webp";

describe("managed image path", () => {
  it("returns only canonical same-tenant image paths", () => {
    expect(managedImagePath(origin + path, tenant, origin, asset)).toBe(path);
    expect(managedImagePath(origin + path, asset, origin)).toBeNull();
    expect(managedImagePath(origin + path, tenant, origin, tenant)).toBeNull();
  });
  it("rejects other origins, private files and URL tokens", () => {
    for (const url of ["https://other.example.test" + path, origin + path.replace(".webp", ".pdf"), origin + path + "?token=x", origin + path + "#x", null]) {
      expect(managedImagePath(url, tenant, origin)).toBeNull();
    }
  });
});
