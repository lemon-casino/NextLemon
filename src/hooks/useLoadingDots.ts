import { useState, useEffect } from "react";

/**
 * 省略号加载动画 Hook
 * 使用 React state 驱动，不触发 GPU 合成，避免字体模糊
 * @param isLoading - 是否正在加载
 * @param interval - 切换间隔，默认 500ms
 * @returns 当前省略号字符串 ("." | ".." | "...")
 */
export function useLoadingDots(isLoading: boolean, interval = 500): string {
  const [dots, setDots] = useState(".");

  useEffect(() => {
    if (!isLoading) {
      setDots(".");
      return;
    }

    const timer = setInterval(() => {
      setDots(prev => {
        if (prev === ".") return "..";
        if (prev === "..") return "...";
        return ".";
      });
    }, interval);

    return () => clearInterval(timer);
  }, [isLoading, interval]);

  return dots;
}
