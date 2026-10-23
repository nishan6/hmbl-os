import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * DEFAULT PIPELINE — the spec's example stages with labelled default
 * probabilities, not approved policy (docs/decisions.md). Created once if
 * missing; administrators rename, reorder, add and archive stages afterwards.
 */
export const DEFAULT_STAGES = [
  { key: "new", name: "New", kind: "OPEN", probabilityBps: 1000 },
  { key: "qualified", name: "Qualified", kind: "OPEN", probabilityBps: 2000 },
  { key: "discovery", name: "Discovery", kind: "OPEN", probabilityBps: 3000 },
  { key: "estimation", name: "Estimation", kind: "OPEN", probabilityBps: 4000 },
  { key: "proposal_sent", name: "Proposal sent", kind: "OPEN", probabilityBps: 6000 },
  { key: "negotiation", name: "Negotiation", kind: "OPEN", probabilityBps: 8000 },
  { key: "won", name: "Won", kind: "WON", probabilityBps: 10000 },
  { key: "lost", name: "Lost", kind: "LOST", probabilityBps: 0 },
  { key: "on_hold", name: "On hold", kind: "ON_HOLD", probabilityBps: null },
  { key: "cancelled", name: "Cancelled", kind: "CANCELLED", probabilityBps: 0 },
] as const;

export async function ensurePipelineDefaults(db: PrismaClient): Promise<string[]> {
  if ((await db.pipelineStage.count()) > 0) return [];
  await db.pipelineStage.createMany({
    data: DEFAULT_STAGES.map((stage, position) => ({ ...stage, position })),
  });
  return DEFAULT_STAGES.map((s) => s.key);
}
