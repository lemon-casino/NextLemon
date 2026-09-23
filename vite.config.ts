/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "fs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// 读取 package.json 获取版本号
const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
);

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  // 注入版本号到应用
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    // 配置本地代理以解决 Web 模式下的 CORS 问题
    proxy: {
      "/api_proxy_lemon": {
        target: "https://geminibiz.lemon.vin",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api_proxy_lemon/, ""),
      },
    },
  },

  // 构建分包：避免全部供应商代码打进单一 entry chunk（曾达 1.8MB / gzip 531KB）。
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Rollup 模块 id 在 Windows 上也是正斜杠，这里统一归一再匹配
          const normalizedId = id.replace(/\\/g, "/");
          if (!normalizedId.includes("/node_modules/")) {
            // creativeStore 独立成块：它被大量组件静态导入、又被 creativeAssetService
            // 动态导入，显式指定 chunk 可让它成为真实的独立分包。
            // 注意：manualChunks 只决定模块归属哪个 chunk，并不能消除 vite:reporter 的
            // "dynamic import will not move module into another chunk" 告警——该告警
            // 源于"同一模块被动态+静态双重导入"的事实本身，与 chunk 归属无关。根因修复
            // 需将 src/services/creativeAssetService.ts 中对 creativeStore 的动态导入
            // 改为静态导入（该文件不在本包可编辑范围）。
            if (normalizedId.includes("/src/stores/creativeStore")) return "creative-store";
            return undefined;
          }
          // react / react-dom / scheduler 与工作流画布 @xyflow 合并为同一 chunk：
          // 两组分开时，它们共享的 use-sync-external-store / zustand / CJS interop
          // 中间层会被 Rollup hoist 进其中一侧，形成 react-vendor <-> flow-vendor
          // 循环块（Circular chunk 警告）。这组依赖彼此闭合、无组外 npm 依赖，
          // 合并后结构上不可能再出现循环边（代价：损失部分拆分粒度）。
          if (
            /\/node_modules\/(react|react-dom|scheduler|use-sync-external-store|zustand|@xyflow)\//.test(
              normalizedId
            )
          ) {
            return "react-vendor";
          }
          // Markdown 渲染链（react-markdown + unified/remark/micromark 生态）
          if (
            /\/node_modules\/(react-markdown|remark|rehype|unified|micromark|mdast|unist|hast|vfile|estree-util|estree-walker|property-information|space-separated-tokens|comma-separated-tokens|trim-lines|decode-named-character-reference|character-entities|character-reference-invalid|web-namespaces|html-url-attributes|is-plain-obj|longest-streak|zwitch|bail|trough|devlop)/.test(
              normalizedId
            )
          ) {
            return "markdown-vendor";
          }
          // 体积较大且按需使用的供应商包
          if (normalizedId.includes("/node_modules/pptxgenjs/")) return "pptx-vendor";
          if (normalizedId.includes("/node_modules/@google/genai/")) return "genai-vendor";
          return undefined;
        },
      },
    },
  },

  // Vitest：单测只收集 src，e2e 由 Playwright 单独运行
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx,js}"],
  },
}));
