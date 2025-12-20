/**
 * Toast 通知状态管理
 * 使用 Zustand 管理全局 toast 消息
 */

import { create } from "zustand";

// Toast 类型
export type ToastType = "success" | "error" | "warning" | "info";

// Toast 消息
export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // 持续时间（毫秒），默认 3000
}

interface ToastState {
  toasts: ToastMessage[];
  // 添加 toast
  addToast: (type: ToastType, message: string, duration?: number) => void;
  // 移除 toast
  removeToast: (id: string) => void;
  // 快捷方法
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (type, message, duration = 3000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const toast: ToastMessage = { id, type, message, duration };

    set((state) => ({
      toasts: [...state.toasts, toast],
    }));

    // 自动移除
    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, duration);
    }
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  // 快捷方法
  success: (message, duration) => get().addToast("success", message, duration),
  error: (message, duration) => get().addToast("error", message, duration ?? 5000),
  warning: (message, duration) => get().addToast("warning", message, duration),
  info: (message, duration) => get().addToast("info", message, duration),
}));

// 导出便捷函数，可以在非 React 组件中使用
export const toast = {
  success: (message: string, duration?: number) =>
    useToastStore.getState().success(message, duration),
  error: (message: string, duration?: number) =>
    useToastStore.getState().error(message, duration),
  warning: (message: string, duration?: number) =>
    useToastStore.getState().warning(message, duration),
  info: (message: string, duration?: number) =>
    useToastStore.getState().info(message, duration),
};
