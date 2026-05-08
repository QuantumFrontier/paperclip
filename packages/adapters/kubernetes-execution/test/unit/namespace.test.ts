import { describe, it, expect } from "vitest";
import { buildNamespace } from "../../src/orchestrator/namespace.js";

describe("buildNamespace", () => {
  it("produces a namespace with paperclip labels and PSS restricted", () => {
    const ns = buildNamespace({
      name: "paperclip-acme-corp",
      companyId: "c-uuid",
      companySlug: "acme-corp",
    });
    expect(ns.kind).toBe("Namespace");
    expect(ns.metadata?.name).toBe("paperclip-acme-corp");
    expect(ns.metadata?.labels?.["paperclip.ai/managed-by"]).toBe("paperclip");
    expect(ns.metadata?.labels?.["paperclip.ai/company-id"]).toBe("c-uuid");
    expect(ns.metadata?.labels?.["paperclip.ai/company-slug"]).toBe("acme-corp");
    expect(ns.metadata?.labels?.["pod-security.kubernetes.io/enforce"]).toBe("restricted");
    expect(ns.metadata?.labels?.["pod-security.kubernetes.io/audit"]).toBe("restricted");
    expect(ns.metadata?.labels?.["pod-security.kubernetes.io/warn"]).toBe("restricted");
  });

  it("merges extra labels with the base set", () => {
    const ns = buildNamespace({
      name: "paperclip-x", companyId: "c", companySlug: "x",
      extraLabels: { "custom/label": "value" },
    });
    expect(ns.metadata?.labels?.["custom/label"]).toBe("value");
    // base labels still present
    expect(ns.metadata?.labels?.["paperclip.ai/managed-by"]).toBe("paperclip");
  });
});
