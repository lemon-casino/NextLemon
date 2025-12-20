import { useState, useRef, useCallback, useEffect } from "react";
import { Edit2, Plus, Trash2, GripVertical, ChevronDown, ChevronUp } from "lucide-react";
import type { PPTOutline } from "./types";

// 独立的文本输入组件，正确处理中文输入法
function ComposableInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [localValue, setLocalValue] = useState(value);
  const isComposingRef = useRef(false);

  useEffect(() => {
    if (!isComposingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  return (
    <input
      type="text"
      className={className}
      value={localValue}
      placeholder={placeholder}
      onChange={(e) => {
        setLocalValue(e.target.value);
        if (!isComposingRef.current) {
          onChange(e.target.value);
        }
      }}
      onCompositionStart={() => { isComposingRef.current = true; }}
      onCompositionEnd={(e) => {
        isComposingRef.current = false;
        onChange(e.currentTarget.value);
      }}
    />
  );
}

// 独立的文本域组件，正确处理中文输入法
function ComposableTextarea({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [localValue, setLocalValue] = useState(value);
  const isComposingRef = useRef(false);

  useEffect(() => {
    if (!isComposingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  return (
    <textarea
      className={className}
      value={localValue}
      placeholder={placeholder}
      onChange={(e) => {
        setLocalValue(e.target.value);
        if (!isComposingRef.current) {
          onChange(e.target.value);
        }
      }}
      onCompositionStart={() => { isComposingRef.current = true; }}
      onCompositionEnd={(e) => {
        isComposingRef.current = false;
        onChange(e.currentTarget.value);
      }}
    />
  );
}

interface OutlineEditorProps {
  outline: PPTOutline;
  onSave: (outline: PPTOutline) => void;
  onCancel: () => void;
}

// 大纲编辑器组件
export function OutlineEditor({ outline, onSave, onCancel }: OutlineEditorProps) {
  const [editedOutline, setEditedOutline] = useState<PPTOutline>(() =>
    JSON.parse(JSON.stringify(outline))
  );
  const [expandedPages, setExpandedPages] = useState<Set<number>>(new Set([0]));

  // 切换页面展开状态
  const togglePage = useCallback((index: number) => {
    setExpandedPages(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // 更新标题
  const updateTitle = useCallback((value: string) => {
    setEditedOutline(prev => ({ ...prev, title: value }));
  }, []);

  // 更新页面字段
  const updatePageField = useCallback((index: number, field: string, value: string | number) => {
    setEditedOutline(prev => ({
      ...prev,
      pages: prev.pages.map((page, i) =>
        i === index ? { ...page, [field]: value } : page
      )
    }));
  }, []);

  // 更新页面要点
  const updatePagePoints = useCallback((pageIndex: number, pointIndex: number, value: string) => {
    setEditedOutline(prev => ({
      ...prev,
      pages: prev.pages.map((page, i) => {
        if (i !== pageIndex) return page;
        const newPoints = [...page.points];
        newPoints[pointIndex] = value;
        return { ...page, points: newPoints };
      })
    }));
  }, []);

  // 添加要点
  const addPoint = useCallback((pageIndex: number) => {
    setEditedOutline(prev => ({
      ...prev,
      pages: prev.pages.map((page, i) => {
        if (i !== pageIndex) return page;
        return { ...page, points: [...page.points, ""] };
      })
    }));
  }, []);

  // 删除要点
  const deletePoint = useCallback((pageIndex: number, pointIndex: number) => {
    setEditedOutline(prev => ({
      ...prev,
      pages: prev.pages.map((page, i) => {
        if (i !== pageIndex) return page;
        return { ...page, points: page.points.filter((_, pi) => pi !== pointIndex) };
      })
    }));
  }, []);

  // 添加页面
  const addPage = useCallback((afterIndex: number) => {
    setEditedOutline(prev => {
      const newPages = [...prev.pages];
      const newPage = {
        pageNumber: afterIndex + 2,
        heading: "新页面",
        points: [""],
        imageDesc: "",
        script: ""
      };
      newPages.splice(afterIndex + 1, 0, newPage);
      // 更新后续页面的页码
      return {
        ...prev,
        pages: newPages.map((page, i) => ({ ...page, pageNumber: i + 1 }))
      };
    });
    setExpandedPages(prev => new Set([...prev, afterIndex + 1]));
  }, []);

  // 删除页面
  const deletePage = useCallback((index: number) => {
    if (editedOutline.pages.length <= 1) return;
    setEditedOutline(prev => ({
      ...prev,
      pages: prev.pages
        .filter((_, i) => i !== index)
        .map((page, i) => ({ ...page, pageNumber: i + 1 }))
    }));
  }, [editedOutline.pages.length]);

  // 移动页面
  const movePage = useCallback((index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= editedOutline.pages.length) return;

    setEditedOutline(prev => {
      const newPages = [...prev.pages];
      [newPages[index], newPages[newIndex]] = [newPages[newIndex], newPages[index]];
      return {
        ...prev,
        pages: newPages.map((page, i) => ({ ...page, pageNumber: i + 1 }))
      };
    });
  }, [editedOutline.pages.length]);

  return (
    <div className="flex flex-col h-full max-h-[600px]">
      {/* 标题编辑 */}
      <div className="mb-3">
        <label className="text-xs text-base-content/60 mb-1 block">PPT 标题</label>
        <ComposableInput
          className="input input-bordered input-sm w-full"
          value={editedOutline.title}
          onChange={updateTitle}
        />
      </div>

      {/* 页面列表 */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {editedOutline.pages.map((page, index) => (
          <div
            key={index}
            className="border border-base-300 rounded-lg overflow-hidden"
          >
            {/* 页面头部 */}
            <div
              className="flex items-center gap-2 px-2 py-1.5 bg-base-200 cursor-pointer"
              onClick={() => togglePage(index)}
            >
              <GripVertical className="w-3 h-3 text-base-content/40" />
              <span className="text-xs font-medium text-primary">
                第 {page.pageNumber} 页
              </span>
              <span className="text-xs text-base-content/70 truncate flex-1">
                {page.heading}
              </span>
              <div className="flex items-center gap-1">
                <button
                  className="btn btn-ghost btn-xs p-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    movePage(index, "up");
                  }}
                  disabled={index === 0}
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  className="btn btn-ghost btn-xs p-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    movePage(index, "down");
                  }}
                  disabled={index === editedOutline.pages.length - 1}
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
                <button
                  className="btn btn-ghost btn-xs p-1 text-error"
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePage(index);
                  }}
                  disabled={editedOutline.pages.length <= 1}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                {expandedPages.has(index) ? (
                  <ChevronUp className="w-4 h-4 text-base-content/40" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-base-content/40" />
                )}
              </div>
            </div>

            {/* 页面内容编辑 */}
            {expandedPages.has(index) && (
              <div className="p-2 space-y-2 bg-base-100">
                {/* 标题 */}
                <div>
                  <label className="text-xs text-base-content/60 mb-0.5 block">页面标题</label>
                  <ComposableInput
                    className="input input-bordered input-xs w-full"
                    value={page.heading}
                    onChange={(value) => updatePageField(index, "heading", value)}
                  />
                </div>

                {/* PPT 要点 */}
                <div>
                  <label className="text-xs text-base-content/60 mb-0.5 block">PPT 要点</label>
                  <div className="space-y-1">
                    {page.points.map((point, pointIndex) => (
                      <div key={pointIndex} className="flex items-center gap-1">
                        <span className="text-xs text-base-content/40 w-4">{pointIndex + 1}.</span>
                        <ComposableInput
                          className="input input-bordered input-xs flex-1"
                          value={point}
                          placeholder="输入要点..."
                          onChange={(value) => updatePagePoints(index, pointIndex, value)}
                        />
                        <button
                          className="btn btn-ghost btn-xs p-1 text-error"
                          onClick={() => deletePoint(index, pointIndex)}
                          disabled={page.points.length <= 1}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    <button
                      className="btn btn-ghost btn-xs text-base-content/60"
                      onClick={() => addPoint(index)}
                    >
                      <Plus className="w-3 h-3" />
                      添加要点
                    </button>
                  </div>
                </div>

                {/* 推荐配图描述 */}
                <div>
                  <label className="text-xs text-base-content/60 mb-0.5 block">推荐配图描述（可选）</label>
                  <ComposableInput
                    className="input input-bordered input-xs w-full"
                    value={page.imageDesc || ""}
                    placeholder="描述适合的图表或示意图..."
                    onChange={(value) => updatePageField(index, "imageDesc", value)}
                  />
                </div>

                {/* 口头讲稿 */}
                <div>
                  <label className="text-xs text-base-content/60 mb-0.5 block">口头讲稿</label>
                  <ComposableTextarea
                    className="textarea textarea-bordered textarea-xs w-full min-h-[80px] resize-none"
                    value={page.script}
                    placeholder="输入演讲时的口头讲稿..."
                    onChange={(value) => updatePageField(index, "script", value)}
                  />
                </div>

                {/* 在此页后添加新页面 */}
                <button
                  className="btn btn-ghost btn-xs w-full text-base-content/60"
                  onClick={() => addPage(index)}
                >
                  <Plus className="w-3 h-3" />
                  在此后添加页面
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 底部操作 */}
      <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-base-300">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          取消
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => onSave(editedOutline)}>
          <Edit2 className="w-3 h-3" />
          保存大纲
        </button>
      </div>
    </div>
  );
}
