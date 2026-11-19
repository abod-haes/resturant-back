#!/usr/bin/env node
/** Fail CI on malformed/doubled YAML keys, broken local refs and missing versioned operations. */
import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";

const spec = parseDocument(readFileSync("openapi/restaurant.v1.yaml","utf8"), {
  uniqueKeys: true, strict: true,
});
if (spec.errors.length) {
  throw new Error("OpenAPI YAML invalid:\n" + spec.errors.map(e => e.message).join("\n"));
}
const doc = spec.toJS();
if (!doc || typeof doc !== "object" || doc.openapi !== "3.1.0" ||
  doc.info?.version !== "0.10.0-draft" || !doc.paths || !doc.components?.schemas) {
  throw new Error("OpenAPI root, version or schemas missing");
}
const ops = new Set();
for (const [path, definitions] of Object.entries(doc.paths)) {
  if (!path.startsWith("/")) throw new Error("Path must be absolute");
  for (const [method, operation] of Object.entries(definitions)) {
    if (!["get","post","patch","put","delete"].includes(method)) continue;
    if (!operation?.operationId || ops.has(operation.operationId)) {
      throw new Error("Missing or duplicate operationId: " + path + " " + method);
    }
    ops.add(operation.operationId);
    if (!operation.responses || !Object.keys(operation.responses).some(k => /^2\d\d$/.test(k))) {
      throw new Error("Operation lacks a successful response: " + operation.operationId);
    }
  }
}
function walk(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(walk); return; }
  if (typeof node.$ref === "string") {
    const prefix = "#/components/schemas/";
    if (!node.$ref.startsWith(prefix) ||
      !(node.$ref.slice(prefix.length) in doc.components.schemas)) {
      throw new Error("Unresolved or external ref: " + node.$ref);
    }
  }
  Object.values(node).forEach(walk);
}
walk(doc);
for (const [path, method] of [
  ["/employee/devices","post"], ["/employee/devices","get"], ["/employee/devices/{id}","delete"],
  ["/owner/events","get"], ["/employee/events","get"],
  ["/public/calls","post"], ["/employee/shifts/start","post"],
  ["/owner/call-analytics","get"], ["/admin/audit-logs","get"],
]) {
  if (!doc.paths[path]?.[method]) throw new Error("Missing contract: " + method + " " + path);
}
for (const path of ["/owner/events","/employee/events","/employee/devices",
  "/owner/call-analytics","/admin/audit-logs"]) {
  const method = path.endsWith("devices") ? "post" : "get";
  if (!doc.paths[path][method].security?.some(x => Object.hasOwn(x, "bearerAuth"))) {
    throw new Error("Bearer security missing from " + path);
  }
}
const fixture = JSON.parse(readFileSync("mocks/contracts/push-realtime-v1.9.json","utf8"));
if (fixture.schemaVersion !== "1.9.0" || fixture.registered?.data?.expoPushToken !== undefined) {
  throw new Error("Push contract fixture version/redaction invalid");
}
const reporting = JSON.parse(readFileSync("mocks/contracts/analytics-audit-v1.10.json","utf8"));
if (reporting.schemaVersion !== "1.10.0" ||
  !Array.isArray(reporting.ownerAnalytics?.data?.daily) ||
  !Array.isArray(reporting.adminAudit?.data) ||
  reporting.adminAudit.data.some(row => "metadata" in row)) {
  throw new Error("v1.10 report/audit contract fixture invalid or leaking metadata");
}
console.log("OpenAPI and versioned fixtures OK (" + ops.size + " operations)");
