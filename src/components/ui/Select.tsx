import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** 是否通过 Portal 渲染到 body，默认 true；在部分桌面环境下可关闭以避免合成问题 */
  usePortal?: boolean;
}

export function Select({
  value,
  options,
  onChange,
  placeholder = "请选择",
  className = "",
  usePortal = true,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // 计算下拉菜单位置
  const updateDropdownPosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 6, // 6px 间距
        left: rect.left,
        width: rect.width,
      });
    }
  }, []);

  // 打开下拉框
  const openDropdown = useCallback(() => {
    setIsOpen(true);
    updateDropdownPosition();
    requestAnimationFrame(() => setIsVisible(true));
  }, [updateDropdownPosition]);

  // 关闭下拉框（带动画）
  const closeDropdown = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => setIsOpen(false), 150);
  }, []);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeDropdown();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, closeDropdown]);

  // 滚动或缩放时关闭下拉框
  useEffect(() => {
    if (isOpen) {
      const handleScroll = () => closeDropdown();
      window.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleScroll);
      return () => {
        window.removeEventListener("scroll", handleScroll, true);
        window.removeEventListener("resize", handleScroll);
      };
    }
  }, [isOpen, closeDropdown]);

  // 下拉菜单内容
  const dropdownContent = (
    <div
      className={`
        py-1 bg-base-100 border border-base-300 rounded-lg shadow-xl overflow-hidden
        transition-all duration-150 ease-out origin-top
        ${isVisible
          ? "opacity-100 scale-100 translate-y-0"
          : "opacity-0 scale-95 -translate-y-1"
        }
      `}
      style={usePortal ? {
        position: "fixed",
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: dropdownPosition.width,
        zIndex: 9999,
      } : {
        position: "absolute",
        width: "100%",
        marginTop: "4px",
        zIndex: 9999,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`
            flex items-center justify-between w-full px-3 py-2 text-sm text-left
            transition-colors duration-150
            ${option.value === value
              ? "bg-primary/10 text-primary"
              : "text-base-content hover:bg-base-200"
            }
          `}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onChange(option.value);
            closeDropdown();
          }}
        >
          <span>{option.label}</span>
          {option.value === value && (
            <Check className="w-4 h-4" />
          )}
        </button>
      ))}
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 触发按钮 */}
      <button
        ref={buttonRef}
        type="button"
        className={`
          flex items-center justify-between w-full h-8 px-3 text-sm rounded-lg
          bg-base-200/50 border border-base-300/60
          hover:bg-base-200 hover:border-base-300
          transition-all duration-200
          ${isOpen ? "ring-2 ring-primary/20 border-primary/50 bg-base-100" : ""}
        `}
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) {
            closeDropdown();
          } else {
            openDropdown();
          }
        }}
      >
        <span className={selectedOption ? "text-base-content" : "text-base-content/40"}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-base-content/40 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        usePortal
          ? createPortal(dropdownContent, document.body)
          : dropdownContent
      )}
    </div>
  );
}
