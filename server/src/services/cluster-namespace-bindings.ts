import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { clusterNamespaceBindings } from "@paperclipai/db";

export interface RecordBindingInput {
  clusterConnectionId: string;
  companyId: string;
  namespaceName: string;
}

export interface ClusterNamespaceBindingsService {
  record(input: RecordBindingInput): Promise<void>;
  getByClusterAndCompany(
    clusterConnectionId: string,
    companyId: string,
  ): Promise<{ id: string; namespaceName: string } | null>;
}

export function clusterNamespaceBindingsService(db: Db): ClusterNamespaceBindingsService {
  return {
    async record(input) {
      const [existing] = await db
        .select()
        .from(clusterNamespaceBindings)
        .where(
          and(
            eq(clusterNamespaceBindings.clusterConnectionId, input.clusterConnectionId),
            eq(clusterNamespaceBindings.companyId, input.companyId),
          ),
        );

      if (existing) {
        await db
          .update(clusterNamespaceBindings)
          .set({ namespaceName: input.namespaceName, updatedAt: new Date() })
          .where(eq(clusterNamespaceBindings.id, existing.id));
        return;
      }

      await db.insert(clusterNamespaceBindings).values({
        clusterConnectionId: input.clusterConnectionId,
        companyId: input.companyId,
        namespaceName: input.namespaceName,
      });
    },

    async getByClusterAndCompany(clusterConnectionId, companyId) {
      const [row] = await db
        .select()
        .from(clusterNamespaceBindings)
        .where(
          and(
            eq(clusterNamespaceBindings.clusterConnectionId, clusterConnectionId),
            eq(clusterNamespaceBindings.companyId, companyId),
          ),
        );
      return row ? { id: row.id, namespaceName: row.namespaceName } : null;
    },
  };
}
