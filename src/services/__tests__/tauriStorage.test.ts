import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDebouncedSaver,
  PERSIST_SAVE_DEBOUNCE_MS,
} from "@/utils/tauriStorage";

describe("createDebouncedSaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a 300ms debounce window by default", () => {
    expect(PERSIST_SAVE_DEBOUNCE_MS).toBe(300);
  });

  it("coalesces schedules within the window into a single save", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createDebouncedSaver(save, PERSIST_SAVE_DEBOUNCE_MS);

    saver.schedule();
    saver.schedule();
    saver.schedule();
    vi.advanceTimersByTime(PERSIST_SAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);

    saver.dispose();
  });

  it("starts a new window after a fired save", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createDebouncedSaver(save, PERSIST_SAVE_DEBOUNCE_MS);

    saver.schedule();
    vi.advanceTimersByTime(PERSIST_SAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);

    saver.schedule();
    vi.advanceTimersByTime(PERSIST_SAVE_DEBOUNCE_MS - 1);
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(2);

    saver.dispose();
  });

  it("flush cancels the pending timer and saves immediately", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createDebouncedSaver(save, PERSIST_SAVE_DEBOUNCE_MS);

    saver.schedule();
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);

    saver.dispose();
  });

  it("flush awaits an in-flight save before resolving", async () => {
    const resolvers: Array<() => void> = [];
    const save = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolvers.push(resolve); })
    );
    const saver = createDebouncedSaver(save, PERSIST_SAVE_DEBOUNCE_MS);

    saver.schedule();
    const flushing = saver.flush();
    expect(save).toHaveBeenCalledTimes(1);

    let settled = false;
    void flushing.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolvers[0]?.();
    await flushing;
    expect(settled).toBe(true);

    saver.dispose();
  });

  it("swallows save errors so flush never rejects", async () => {
    const save = vi.fn().mockRejectedValue(new Error("disk full"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const saver = createDebouncedSaver(save, PERSIST_SAVE_DEBOUNCE_MS);

    saver.schedule();
    await expect(saver.flush()).resolves.toBeUndefined();
    expect(save).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
    saver.dispose();
  });

  it("dispose drops the pending save", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createDebouncedSaver(save, PERSIST_SAVE_DEBOUNCE_MS);

    saver.schedule();
    saver.dispose();
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();
  });
});
