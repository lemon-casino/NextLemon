import { expect, test } from "@playwright/test";

// 双模式工作区冒烟：应用加载、创作画布基础交互（添加文本/撤销）、助手面板。
// 覆盖发布说明中的 UI 冒烟缺口；运行前需 npx playwright install chromium。

test.describe("NextLemon 双模式工作区", () => {
  test("默认进入工作流模式并显示模式切换器", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "工作流" })).toBeVisible();
    await expect(page.getByRole("button", { name: "创作画布" })).toBeVisible();
  });

  test("创作画布：添加文本素材并撤销", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "创作画布" }).click();
    await expect(page.getByText("素材创作画布")).toBeVisible();

    // 撤销只覆盖画布实例（素材库条目保留），因此用 data-creative-item 精确定位画布层
    const canvasItems = page.locator("[data-creative-item]");
    await expect(canvasItems).toHaveCount(0);
    await page.getByRole("button", { name: "文本" }).click();
    await expect(canvasItems).toHaveCount(1);

    await page.keyboard.press("Control+z");
    await expect(canvasItems).toHaveCount(0);
  });

  test("画布助手面板可打开并显示空状态", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "创作画布" }).click();
    await page.locator('button[title="画布助手"]').click();
    await expect(page.getByText("创建一个 Agent 会话")).toBeVisible();
  });
});
