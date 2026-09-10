import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildMentionInsertion,
  findActiveMentionTrigger,
} from "@/services/creativeAssetService";
import type { CreativeAsset } from "@/types/creative";

interface AssetMentionTextareaProps {
  value: string;
  onChange: (text: string) => void;
  assets: CreativeAsset[];
  className?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  onEscape?: () => void;
  onPointerDown?: (event: React.PointerEvent<HTMLTextAreaElement>) => void;
}

// 支持 @[asset_N] 提及的文本编辑器：输入 @ 弹出素材选择列表（portal 渲染，
// 避免被画布 transform 缩放），点击/回车插入完整标记。
export function AssetMentionTextarea({
  value,
  onChange,
  assets,
  className,
  autoFocus,
  onBlur,
  onEscape,
  onPointerDown,
}: AssetMentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [popupPosition, setPopupPosition] = useState<{ top: number; left: number } | null>(null);

  const labeledAssets = useMemo(
    () => assets.filter((asset) => asset.label),
    [assets]
  );

  const options = useMemo(() => {
    const normalized = query.replace(/^\[/, "").toLowerCase();
    return labeledAssets
      .filter(
        (asset) =>
          asset.label!.toLowerCase().startsWith(normalized) ||
          asset.title.toLowerCase().includes(normalized)
      )
      .slice(0, 6);
  }, [labeledAssets, query]);

  const syncTrigger = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const caret = textarea.selectionStart ?? value.length;
    const start = findActiveMentionTrigger(textarea.value, caret);
    setTrigger(start);
    setQuery(start === null ? "" : textarea.value.slice(start + 1, caret));
    setActiveIndex(0);
    if (start !== null) {
      const rect = textarea.getBoundingClientRect();
      setPopupPosition({ top: rect.bottom + 4, left: rect.left });
    } else {
      setPopupPosition(null);
    }
  };

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const insertMention = (label: string) => {
    const textarea = textareaRef.current;
    if (!textarea || trigger === null) return;
    const caret = textarea.selectionStart ?? value.length;
    const next = buildMentionInsertion(textarea.value, caret, trigger, label);
    onChange(next.text);
    setTrigger(null);
    setPopupPosition(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <>
      <textarea
        ref={textareaRef}
        className={className}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => {
          onChange(event.target.value);
          requestAnimationFrame(syncTrigger);
        }}
        onKeyUp={syncTrigger}
        onClick={syncTrigger}
        onBlur={() => {
          window.setTimeout(() => {
            setTrigger(null);
            setPopupPosition(null);
          }, 150);
          onBlur?.();
        }}
        onPointerDown={onPointerDown}
        onKeyDown={(event) => {
          if (trigger !== null && options.length > 0) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % options.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => (index - 1 + options.length) % options.length);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              insertMention(options[activeIndex].label!);
              return;
            }
          }
          if (event.key === "Escape") {
            setTrigger(null);
            setPopupPosition(null);
            onEscape?.();
          }
          event.stopPropagation();
        }}
      />
      {trigger !== null &&
        popupPosition &&
        options.length > 0 &&
        createPortal(
          <div
            className="fixed z-[90] w-64 overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-xl"
            style={{ top: popupPosition.top, left: popupPosition.left }}
          >
            <div className="border-b border-base-300/60 px-3 py-1 text-[10px] text-base-content/45">
              选择素材插入 @[asset_N]（↑↓ 选择，回车插入）
            </div>
            {options.map((asset, index) => (
              <button
                key={asset.id}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-base-200 ${
                  index === activeIndex ? "bg-base-200" : ""
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertMention(asset.label!);
                }}
              >
                <span className="badge badge-xs badge-outline flex-shrink-0">{asset.label}</span>
                <span className="truncate">{asset.title}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
