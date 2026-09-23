import { beforeEach, describe, expect, it } from "vitest";
import { useAgentStore } from "@/stores/agentStore";
import type { AgentRollbackSnapshot } from "@/types/agent";
import type { CreativeCanvasData } from "@/types/creative";

const canvas: CreativeCanvasData = {
  id: "creative-main",
  title: "素材创作画布",
  items: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  createdAt: 1,
  updatedAt: 1,
};

function snapshot(id: string): AgentRollbackSnapshot {
  return {
    id,
    createdAt: 1,
    opSummary: `op-${id}`,
    opTypes: ["asset.add"],
    creative: { assets: [], canvas, selectedItemIds: [] },
    workflow: { nodes: [], edges: [], selectedNodeIds: [] },
  };
}

describe("agentStore", () => {
  beforeEach(() => {
    useAgentStore.setState({
      sessions: [],
      activeSessionId: null,
      rollbackHistory: [],
      lastRollback: null,
    });
  });

  describe("renameSession", () => {
    it("renames a session and trims surrounding whitespace", () => {
      const sessionId = useAgentStore.getState().createSession("旧标题", "local");
      useAgentStore.getState().renameSession(sessionId, "  新标题  ");

      const session = useAgentStore.getState().sessions.find((item) => item.id === sessionId);
      expect(session?.title).toBe("新标题");
    });

    it("ignores blank titles", () => {
      const sessionId = useAgentStore.getState().createSession("旧标题", "local");
      useAgentStore.getState().renameSession(sessionId, "   ");

      const session = useAgentStore.getState().sessions.find((item) => item.id === sessionId);
      expect(session?.title).toBe("旧标题");
    });
  });

  describe("rollback ring history", () => {
    it("keeps at most 3 snapshots and exposes the latest via lastRollback", () => {
      const { recordRollbackSnapshot } = useAgentStore.getState();
      recordRollbackSnapshot(snapshot("s1"));
      recordRollbackSnapshot(snapshot("s2"));
      recordRollbackSnapshot(snapshot("s3"));
      recordRollbackSnapshot(snapshot("s4"));

      const state = useAgentStore.getState();
      expect(state.rollbackHistory.map((item) => item.id)).toEqual(["s2", "s3", "s4"]);
      expect(state.lastRollback?.id).toBe("s4");
    });

    it("pops the most recent snapshot when a rollback is undone", () => {
      const { recordRollbackSnapshot, markRollbackUndone } = useAgentStore.getState();
      recordRollbackSnapshot(snapshot("s1"));
      recordRollbackSnapshot(snapshot("s2"));

      markRollbackUndone();
      expect(useAgentStore.getState().rollbackHistory.map((item) => item.id)).toEqual(["s1"]);
      expect(useAgentStore.getState().lastRollback?.id).toBe("s1");

      markRollbackUndone();
      expect(useAgentStore.getState().rollbackHistory).toEqual([]);
      expect(useAgentStore.getState().lastRollback).toBeNull();
    });
  });
});
