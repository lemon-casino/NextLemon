/**
 * Toast 通知组件
 * 使用 daisyUI alert 样式
 */

import { createPortal } from "react-dom";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { useToastStore, type ToastType } from "@/stores/toastStore";

// Toast 类型配置
const toastConfig: Record<ToastType, {
  icon: React.ReactNode;
  alertClass: string;
}> = {
  success: {
    icon: <CheckCircle className="w-5 h-5" />,
    alertClass: "alert-success",
  },
  error: {
    icon: <XCircle className="w-5 h-5" />,
    alertClass: "alert-error",
  },
  warning: {
    icon: <AlertTriangle className="w-5 h-5" />,
    alertClass: "alert-warning",
  },
  info: {
    icon: <Info className="w-5 h-5" />,
    alertClass: "alert-info",
  },
};

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="toast toast-top toast-center z-[99999] pt-4">
      {toasts.map((toast) => {
        const config = toastConfig[toast.type];
        return (
          <div
            key={toast.id}
            className={`
              alert ${config.alertClass} shadow-lg
              animate-in slide-in-from-top-2 fade-in duration-200
              min-w-[280px] max-w-[400px]
            `}
          >
            {config.icon}
            <span className="flex-1 text-sm">{toast.message}</span>
            <button
              className="btn btn-ghost btn-xs btn-circle"
              onClick={() => removeToast(toast.id)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}

export default ToastContainer;
