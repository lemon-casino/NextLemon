/**
 * Tauri Store 存储适配器
 * 用于 Zustand persist 中间件，在 Tauri 环境使用 tauri-plugin-store
 * 浏览器环境降级到 localStorage
 */

import { isTauriEnvironment } from "@/services/fileStorageService";

// Store 实例缓存
let storeInstance: Awaited<ReturnType<typeof import("@tauri-apps/plugin-store").load>> | null = null;
// Store 初始化 Promise，避免重复初始化
let storeInitPromise: Promise<Awaited<ReturnType<typeof import("@tauri-apps/plugin-store").load>> | null> | null = null;

// 落盘防抖窗口：zustand persist 每次状态 set 都会调用 setItem，
// 真正昂贵的是 Tauri store.save() 的 IPC + 磁盘写入，按窗口合并为一次。
export const PERSIST_SAVE_DEBOUNCE_MS = 300;

// 可注入的防抖落盘调度器（纯逻辑，便于单测）：窗口内重复 schedule 合并，
// flush 立即落盘并等待在途保存完成，dispose 丢弃未触发的保存。
export interface DebouncedSaver {
  schedule: () => void;
  flush: () => Promise<void>;
  dispose: () => void;
}

export function createDebouncedSaver(
  save: () => Promise<void>,
  delayMs: number = PERSIST_SAVE_DEBOUNCE_MS
): DebouncedSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const runSave = () => {
    inFlight = save()
      .catch((error) => {
        console.error("Storage flush error:", error);
      })
      .finally(() => {
        inFlight = null;
      });
  };

  return {
    schedule() {
      // 已有待触发的保存时直接合并：触发时会写入最新状态
      if (timer != null) return;
      timer = setTimeout(() => {
        timer = null;
        runSave();
      }, delayMs);
    },
    async flush() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
        runSave();
      }
      if (inFlight) await inFlight;
    },
    dispose() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

// 模块级单例：所有 key 共用一个保存定时器（store.save() 本身就是全量落盘）
const debouncedSaver = createDebouncedSaver(async () => {
  const store = await getStore();
  if (store) {
    await store.save();
  }
});

// 页面隐藏/卸载时立即落盘，避免防抖窗口内的变更丢失
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void debouncedSaver.flush();
    }
  });
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    void debouncedSaver.flush();
  });
  window.addEventListener("beforeunload", () => {
    void debouncedSaver.flush();
  });
}

// 供关键操作后显式立即落盘使用
export function flushTauriStorage(): Promise<void> {
  return debouncedSaver.flush();
}

// 获取或创建 Store 实例
async function getStore() {
  if (!isTauriEnvironment()) {
    return null;
  }

  // 如果正在初始化中，等待完成
  if (storeInitPromise) {
    return storeInitPromise;
  }

  // 如果已经初始化完成，直接返回
  if (storeInstance) {
    return storeInstance;
  }

  // 开始初始化
  storeInitPromise = (async () => {
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      // 使用 load 函数加载或创建 store 文件
      storeInstance = await load("app-data.json", { autoSave: false, defaults: {} });
      return storeInstance;
    } catch (error) {
      console.error("Failed to initialize Tauri store:", error);
      storeInitPromise = null;
      return null;
    }
  })();

  return storeInitPromise;
}

// 获取数据
async function getItem(key: string): Promise<string | null> {
  try {
    const store = await getStore();

    if (store) {
      // Tauri 环境：从 store 读取
      const value = await store.get<string>(key);
      return value ?? null;
    } else {
      // 浏览器环境：降级到 localStorage
      return localStorage.getItem(key);
    }
  } catch (error) {
    console.error("Storage getItem error:", error);
    // 出错时尝试 localStorage
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

// 设置数据
async function setItem(key: string, value: string): Promise<void> {
  try {
    const store = await getStore();

    if (store) {
      // Tauri 环境：写入内存 store（后续读取立即可见），
      // 磁盘落盘走防抖，页面隐藏/卸载时 flush 兜底
      await store.set(key, value);
      debouncedSaver.schedule();
    } else {
      // 浏览器环境：降级到 localStorage
      localStorage.setItem(key, value);
    }
  } catch (error) {
    console.error("Storage setItem error:", error);
    // 出错时尝试 localStorage
    try {
      localStorage.setItem(key, value);
    } catch {
      // 忽略
    }
  }
}

// 删除数据
async function removeItem(key: string): Promise<void> {
  try {
    const store = await getStore();

    if (store) {
      // Tauri 环境：从 store 删除（落盘同样走防抖）
      await store.delete(key);
      debouncedSaver.schedule();
    } else {
      // 浏览器环境：降级到 localStorage
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.error("Storage removeItem error:", error);
    // 出错时尝试 localStorage
    try {
      localStorage.removeItem(key);
    } catch {
      // 忽略
    }
  }
}

// 导出符合 Zustand StateStorage 接口的对象
export const tauriStorage = {
  getItem,
  setItem,
  removeItem,
};
