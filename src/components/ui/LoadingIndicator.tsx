/**
 * 加载指示器组件
 * 使用脉冲/点动画替代旋转动画，避免 GPU 合成层导致的字体模糊问题
 */
import { memo } from "react";

interface LoadingIndicatorProps {
  size?: "xs" | "sm" | "md" | "lg";
  variant?: "dots" | "pulse" | "bars";
  className?: string;
}

// 尺寸映射
const sizeMap = {
  xs: { container: "w-3 h-3", dot: "w-1 h-1", bar: "w-0.5 h-2" },
  sm: { container: "w-4 h-4", dot: "w-1 h-1", bar: "w-0.5 h-3" },
  md: { container: "w-5 h-5", dot: "w-1.5 h-1.5", bar: "w-1 h-4" },
  lg: { container: "w-6 h-6", dot: "w-2 h-2", bar: "w-1 h-5" },
};

/**
 * 点状加载动画 - 三个点依次闪烁
 */
const DotsLoader = memo(({ size, className }: { size: "xs" | "sm" | "md" | "lg"; className?: string }) => {
  const { container, dot } = sizeMap[size];
  return (
    <div className={`${container} flex items-center justify-center gap-0.5 ${className || ""}`}>
      <span
        className={`${dot} rounded-full bg-current animate-[pulse-dot_1s_ease-in-out_infinite]`}
        style={{ animationDelay: "0ms" }}
      />
      <span
        className={`${dot} rounded-full bg-current animate-[pulse-dot_1s_ease-in-out_infinite]`}
        style={{ animationDelay: "150ms" }}
      />
      <span
        className={`${dot} rounded-full bg-current animate-[pulse-dot_1s_ease-in-out_infinite]`}
        style={{ animationDelay: "300ms" }}
      />
    </div>
  );
});
DotsLoader.displayName = "DotsLoader";

/**
 * 脉冲圆环动画 - 圆环脉冲扩散
 */
const PulseLoader = memo(({ size, className }: { size: "xs" | "sm" | "md" | "lg"; className?: string }) => {
  const { container } = sizeMap[size];
  return (
    <div className={`${container} relative ${className || ""}`}>
      <span className="absolute inset-0 rounded-full border-2 border-current opacity-75 animate-[ping-slow_1.5s_ease-out_infinite]" />
      <span className="absolute inset-[25%] rounded-full bg-current" />
    </div>
  );
});
PulseLoader.displayName = "PulseLoader";

/**
 * 条形加载动画 - 三条竖线依次变高
 */
const BarsLoader = memo(({ size, className }: { size: "xs" | "sm" | "md" | "lg"; className?: string }) => {
  const { container, bar } = sizeMap[size];
  return (
    <div className={`${container} flex items-center justify-center gap-0.5 ${className || ""}`}>
      <span
        className={`${bar} rounded-full bg-current animate-[scale-bar_0.8s_ease-in-out_infinite]`}
        style={{ animationDelay: "0ms" }}
      />
      <span
        className={`${bar} rounded-full bg-current animate-[scale-bar_0.8s_ease-in-out_infinite]`}
        style={{ animationDelay: "150ms" }}
      />
      <span
        className={`${bar} rounded-full bg-current animate-[scale-bar_0.8s_ease-in-out_infinite]`}
        style={{ animationDelay: "300ms" }}
      />
    </div>
  );
});
BarsLoader.displayName = "BarsLoader";

/**
 * 加载指示器
 */
export const LoadingIndicator = memo(({
  size = "sm",
  variant = "dots",
  className
}: LoadingIndicatorProps) => {
  switch (variant) {
    case "pulse":
      return <PulseLoader size={size} className={className} />;
    case "bars":
      return <BarsLoader size={size} className={className} />;
    case "dots":
    default:
      return <DotsLoader size={size} className={className} />;
  }
});
LoadingIndicator.displayName = "LoadingIndicator";
