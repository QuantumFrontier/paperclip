import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startEmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestDatabase,
  createDb,
} from "@paperclipai/db";
import type { Db } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { clusterNamespaceBindingsService } from "./cluster-namespace-bindings.js";

let dbHandle: EmbeddedPostgresTestDatabase;
let db: Db;
let clusterId: string;
let companyId: string;

beforeAll(async () => {
  dbHandle = await startEmbeddedPostgresTestDatabase("paperclip-ns-binding-test-");
  db = createDb(dbHandle.connectionString);

  // Seed a cluster connection
  const clusterRows = await db.execute(sql`
    INSERT INTO cluster_connections (label, kind, capabilities, created_by)
    VALUES ('seed-cluster', 'in-cluster', '{"cilium":false,"storageClass":"standard","architectures":["amd64"]}'::jsonb, 'sys')
    RETURNING id
  `);
  clusterId =
    (clusterRows.rows?.[0] as { id: string } | undefined)?.id ??
    (clusterRows[0] as { id: string }).id;

  // Seed a company
  const companyRows = await db.execute(sql`
    INSERT INTO companies (name)
    VALUES ('Acme')
    RETURNING id
  `);
  companyId =
    (companyRows.rows?.[0] as { id: string } | undefined)?.id ??
    (companyRows[0] as { id: string }).id;
});

afterAll(async () => {
  await dbHandle.cleanup();
});

describe("clusterNamespaceBindingsService", () => {
  it("getByClusterAndCompany() returns null when no binding exists", async () => {
    const svc = clusterNamespaceBindingsService(db);
    const result = await svc.getByClusterAndCompany(clusterId, companyId);
    expect(result).toBeNull();
  });

  it("record() creates a new binding", async () => {
    const svc = clusterNamespaceBindingsService(db);
    await svc.record({
      clusterConnectionId: clusterId,
      companyId,
      namespaceName: "paperclip-acme",
    });

    const found = await svc.getByClusterAndCompany(clusterId, companyId);
    expect(found).not.toBeNull();
    expect(found?.namespaceName).toBe("paperclip-acme");
  });

  it("record() is idempotent — second call updates the namespace name", async () => {
    const svc = clusterNamespaceBindingsService(db);
    await svc.record({
      clusterConnectionId: clusterId,
      companyId,
      namespaceName: "paperclip-acme-v2",
    });

    const found = await svc.getByClusterAndCompany(clusterId, companyId);
    expect(found?.namespaceName).toBe("paperclip-acme-v2");
  });

  it("record() preserves other rows when called for a different company", async () => {
    const svc = clusterNamespaceBindingsService(db);

    // Seed a second company
    const otherRows = await db.execute(sql`
      INSERT INTO companies (name, issue_prefix)
      VALUES ('Beta Corp', 'BET')
      RETURNING id
    `);
    const otherCompanyId =
      (otherRows.rows?.[0] as { id: string } | undefined)?.id ??
      (otherRows[0] as { id: string }).id;

    await svc.record({
      clusterConnectionId: clusterId,
      companyId: otherCompanyId,
      namespaceName: "paperclip-beta-corp",
    });

    // Original binding should still be paperclip-acme-v2
    const acme = await svc.getByClusterAndCompany(clusterId, companyId);
    expect(acme?.namespaceName).toBe("paperclip-acme-v2");

    // New binding should be paperclip-beta-corp
    const beta = await svc.getByClusterAndCompany(clusterId, otherCompanyId);
    expect(beta?.namespaceName).toBe("paperclip-beta-corp");
  });
});
