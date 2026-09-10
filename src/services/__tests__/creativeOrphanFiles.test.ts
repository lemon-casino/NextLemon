import { describe, expect, it } from "vitest";
import {
  collectOrphanCreativeFiles,
  type OrphanFileCandidate,
} from "@/services/creativeAssetService";

function candidate(path: string, size: number, scope: OrphanFileCandidate["scope"]): OrphanFileCandidate {
  return { path, size, scope };
}

describe("collectOrphanCreativeFiles", () => {
  it("keeps referenced files and flags unreferenced ones by scope", () => {
    const plan = collectOrphanCreativeFiles(
      ["C:/data/media/a.mp4", "C:/data/images/creative-canvas/b.png"],
      [
        candidate("C:/data/media/a.mp4", 1000, "media"),
        candidate("C:/data/media/orphan.mp4", 2000, "media"),
        candidate("C:/data/images/creative-canvas/b.png", 300, "creative-image"),
        candidate("C:/data/images/creative-canvas/orphan.png", 400, "creative-image"),
      ]
    );

    expect(plan.orphanMediaPaths).toEqual(["C:/data/media/orphan.mp4"]);
    expect(plan.orphanImagePaths).toEqual(["C:/data/images/creative-canvas/orphan.png"]);
    expect(plan.orphanBytes).toBe(2400);
  });

  it("treats every candidate as orphan when no assets exist", () => {
    const plan = collectOrphanCreativeFiles([], [
      candidate("C:/data/media/x.mp4", 10, "media"),
    ]);
    expect(plan.orphanMediaPaths).toHaveLength(1);
  });

  it("ignores empty or whitespace references", () => {
    const plan = collectOrphanCreativeFiles([undefined, "", "   "], [
      candidate("C:/data/media/y.mp4", 5, "media"),
    ]);
    expect(plan.orphanMediaPaths).toEqual(["C:/data/media/y.mp4"]);
  });
});
