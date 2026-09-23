import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMediaLoadStateMachine,
  MEDIA_LOAD_TIMEOUT_MS,
  mediaCrossOrigin,
  nextMediaLoadStage,
} from "@/utils/mediaLoadStrategy";

describe("nextMediaLoadStage", () => {
  it("degrades cors -> direct -> failed and stops at failed", () => {
    expect(nextMediaLoadStage("cors")).toBe("direct");
    expect(nextMediaLoadStage("direct")).toBe("failed");
    expect(nextMediaLoadStage("failed")).toBe("failed");
  });

  it("reaches the failed terminal state after both attempts", () => {
    let stage = nextMediaLoadStage("cors");
    expect(stage).toBe("direct");
    stage = nextMediaLoadStage(stage);
    expect(stage).toBe("failed");
    stage = nextMediaLoadStage(stage);
    expect(stage).toBe("failed");
  });
});

describe("mediaCrossOrigin", () => {
  it("sets anonymous only on the first cors attempt", () => {
    expect(mediaCrossOrigin("cors")).toBe("anonymous");
    expect(mediaCrossOrigin("direct")).toBeUndefined();
    expect(mediaCrossOrigin("failed")).toBeUndefined();
  });
});

describe("MEDIA_LOAD_TIMEOUT_MS", () => {
  it("keeps a bounded wait for remote media", () => {
    expect(MEDIA_LOAD_TIMEOUT_MS).toBeGreaterThan(0);
    expect(MEDIA_LOAD_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("createMediaLoadStateMachine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at the cors stage with anonymous crossOrigin", () => {
    const machine = createMediaLoadStateMachine("image");
    expect(machine.getSnapshot()).toEqual({
      stage: "cors",
      ready: false,
      failed: false,
      crossOrigin: "anonymous",
    });
    machine.dispose();
  });

  it("degrades cors -> direct -> failed on repeated errors", () => {
    const machine = createMediaLoadStateMachine("image");

    machine.notifyError();
    expect(machine.getSnapshot().stage).toBe("direct");
    expect(machine.getSnapshot().crossOrigin).toBeUndefined();
    expect(machine.getSnapshot().failed).toBe(false);

    machine.notifyError();
    expect(machine.getSnapshot().failed).toBe(true);

    // failed 是终态：继续 onError 不再变化
    machine.notifyError();
    expect(machine.getSnapshot().stage).toBe("failed");
    machine.dispose();
  });

  it("notifies subscribers on transitions and stops after unsubscribe", () => {
    const machine = createMediaLoadStateMachine("image");
    const seen: string[] = [];
    const unsubscribe = machine.subscribe(() => seen.push(machine.getSnapshot().stage));

    machine.notifyError();
    machine.notifyError();
    unsubscribe();
    machine.notifyError();
    expect(seen).toEqual(["direct", "failed"]);
    machine.dispose();
  });

  it("advances the video stage after timeout without ready, then fails", () => {
    const machine = createMediaLoadStateMachine("video");

    vi.advanceTimersByTime(MEDIA_LOAD_TIMEOUT_MS - 1);
    expect(machine.getSnapshot().stage).toBe("cors");

    vi.advanceTimersByTime(1);
    expect(machine.getSnapshot().stage).toBe("direct");
    expect(machine.getSnapshot().crossOrigin).toBeUndefined();

    // direct 阶段重新武装超时：继续无响应则进入 failed
    vi.advanceTimersByTime(MEDIA_LOAD_TIMEOUT_MS);
    expect(machine.getSnapshot().failed).toBe(true);
    machine.dispose();
  });

  it("never arms timeouts for images", () => {
    const machine = createMediaLoadStateMachine("image");
    vi.advanceTimersByTime(MEDIA_LOAD_TIMEOUT_MS * 3);
    expect(machine.getSnapshot().stage).toBe("cors");
    machine.dispose();
  });

  it("cancels the pending timeout once ready fires", () => {
    const machine = createMediaLoadStateMachine("audio");

    machine.notifyReady();
    expect(machine.getSnapshot().ready).toBe(true);

    vi.advanceTimersByTime(MEDIA_LOAD_TIMEOUT_MS * 2);
    expect(machine.getSnapshot().stage).toBe("cors");
    machine.dispose();
  });

  it("re-arms the timeout after ready then error", () => {
    const machine = createMediaLoadStateMachine("video");

    machine.notifyReady();
    machine.notifyError();
    expect(machine.getSnapshot().stage).toBe("direct");
    expect(machine.getSnapshot().ready).toBe(false);

    vi.advanceTimersByTime(MEDIA_LOAD_TIMEOUT_MS);
    expect(machine.getSnapshot().failed).toBe(true);
    machine.dispose();
  });

  it("reset returns to cors and re-arms the timeout", () => {
    const machine = createMediaLoadStateMachine("video");

    machine.notifyError();
    expect(machine.getSnapshot().stage).toBe("direct");

    machine.reset();
    expect(machine.getSnapshot()).toEqual({
      stage: "cors",
      ready: false,
      failed: false,
      crossOrigin: "anonymous",
    });

    vi.advanceTimersByTime(MEDIA_LOAD_TIMEOUT_MS);
    expect(machine.getSnapshot().stage).toBe("direct");
    machine.dispose();
  });

  it("supports injectable timers for deterministic environments", () => {
    const handlers: Array<() => void> = [];
    const machine = createMediaLoadStateMachine("video", {
      scheduleTimer: (handler) => {
        handlers.push(handler);
        return handlers.length as unknown as ReturnType<typeof setTimeout>;
      },
      cancelTimer: () => {},
    });

    // 创建即武装 cors 阶段超时
    expect(handlers).toHaveLength(1);

    handlers[0]?.();
    expect(machine.getSnapshot().stage).toBe("direct");
    // direct 阶段重新武装
    expect(handlers).toHaveLength(2);

    machine.dispose();
  });
});
