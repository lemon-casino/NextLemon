import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  LayoutGrid,
  Blocks,
  Plus,
  MoreHorizontal,
  Trash2,
  Copy,
  Edit3,
  Check,
  X,
  ChevronRight,
  GripVertical,
  BookText,
  Eye,
  User,
  Search,
  ChevronDown,
} from "lucide-react";
import { useCanvasStore, type SidebarView, type CanvasData } from "@/stores/canvasStore";
import { useUserPromptStore, type UserPrompt, type CreatePromptInput } from "@/stores/userPromptStore";
import { nodeCategories, nodeIconMap, nodeIconColors } from "@/config/nodeConfig";
import { promptCategories, promptIconMap, promptIconColors, type PromptItem } from "@/config/promptConfig";
import { Input } from "@/components/ui/Input";
import { PromptPreviewModal } from "@/components/ui/PromptPreviewModal";
import { PromptEditModal } from "@/components/ui/PromptEditModal";

// 导航项定义
const navItems: { id: SidebarView; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { id: "canvases", icon: LayoutGrid, label: "画布" },
  { id: "nodes", icon: Blocks, label: "节点" },
  { id: "prompts", icon: BookText, label: "提示" },
];

interface SidebarProps {
  onDragStart: (event: React.DragEvent, nodeType: string, defaultData: Record<string, unknown>) => void;
}

export function Sidebar({ onDragStart }: SidebarProps) {
  const {
    canvases,
    activeCanvasId,
    sidebarView,
    setSidebarView,
    createCanvas,
    deleteCanvas,
    renameCanvas,
    switchCanvas,
    duplicateCanvas,
    reorderCanvases,
  } = useCanvasStore();

  // 画布相关状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [isCanvasesExpanded, setIsCanvasesExpanded] = useState(true);

  // 画布拖拽排序状态
  const [draggingCanvasId, setDraggingCanvasId] = useState<string | null>(null);

  // 节点面板相关状态
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(nodeCategories.map((c) => c.id))
  );

  // 提示词面板相关状态
  const [promptSearchQuery, setPromptSearchQuery] = useState("");
  const [expandedPromptCategories, setExpandedPromptCategories] = useState<Set<string>>(
    new Set(promptCategories.map((c) => c.id))
  );
  const [previewPrompt, setPreviewPrompt] = useState<PromptItem | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);

  // 用户自定义提示词
  const { prompts: userPrompts, addPrompt, updatePrompt, deletePrompt } = useUserPromptStore();
  const [isUserPromptsExpanded, setIsUserPromptsExpanded] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingUserPrompt, setEditingUserPrompt] = useState<UserPrompt | null>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpenId) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // 如果点击的不是菜单内容，关闭菜单
      if (!target.closest(".canvas-context-menu")) {
        setMenuOpenId(null);
        setMenuPosition(null);
      }
    };

    // ESC 键关闭菜单
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpenId(null);
        setMenuPosition(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpenId]);

  // 打开菜单
  const openMenu = useCallback((canvasId: string) => {
    const button = menuButtonRefs.current.get(canvasId);
    if (button) {
      const rect = button.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.right - 128, // 菜单宽度 128px，右对齐
      });
      setMenuOpenId(canvasId);
    }
  }, []);

  // 画布操作
  const startEditing = useCallback((id: string, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
    setMenuOpenId(null);
  }, []);

  const saveEdit = useCallback(() => {
    if (editingId && editName.trim()) {
      renameCanvas(editingId, editName.trim());
    }
    setEditingId(null);
    setEditName("");
  }, [editingId, editName, renameCanvas]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditName("");
  }, []);

  const handleDelete = useCallback((id: string) => {
    deleteCanvas(id);
    setMenuOpenId(null);
  }, [deleteCanvas]);

  const handleDuplicate = useCallback((id: string) => {
    duplicateCanvas(id);
    setMenuOpenId(null);
  }, [duplicateCanvas]);

  const handleCreateCanvas = useCallback(() => {
    createCanvas();
  }, [createCanvas]);

  // 画布排序处理
  const handleCanvasDragStart = (e: React.DragEvent, id: string) => {
    setDraggingCanvasId(id);
    e.dataTransfer.effectAllowed = "move";
    // 设一个透明图像或空图像，如果不想显示默认 Ghost
    // e.dataTransfer.setDragImage(new Image(), 0, 0); 
  };

  const handleCanvasDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggingCanvasId || draggingCanvasId === targetId) return;

    const currentIndex = canvases.findIndex((c) => c.id === draggingCanvasId);
    const targetIndex = canvases.findIndex((c) => c.id === targetId);

    if (currentIndex !== -1 && targetIndex !== -1) {
      // 简单排序：立即交换 (Swap)
      // 注意：频繁 setState 可能会抖动，这里数据量小应该还好
      // 也可以用 throttle 优化
      const newCanvases = [...canvases];
      const [movedItem] = newCanvases.splice(currentIndex, 1);
      newCanvases.splice(targetIndex, 0, movedItem);
      reorderCanvases(newCanvases);
    }
  };

  const handleCanvasDragEnd = () => {
    setDraggingCanvasId(null);
  };

  // 节点面板操作
  const toggleCategory = useCallback((categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }, []);

  // 提示词面板操作
  const togglePromptCategory = useCallback((categoryId: string) => {
    setExpandedPromptCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }, []);

  // 打开提示词预览 Modal
  const openPromptPreview = useCallback((prompt: PromptItem) => {
    setPreviewPrompt(prompt);
    setIsPreviewModalOpen(true);
  }, []);

  // 关闭提示词预览 Modal
  const closePromptPreview = useCallback(() => {
    setIsPreviewModalOpen(false);
  }, []);

  // 过滤节点
  const filteredCategories = nodeCategories
    .map((category) => ({
      ...category,
      nodes: category.nodes.filter(
        (node) =>
          node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          node.description.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    }))
    .filter((category) => category.nodes.length > 0);

  // 过滤提示词
  const filteredPromptCategories = promptCategories
    .map((category) => ({
      ...category,
      prompts: category.prompts.filter(
        (prompt) =>
          prompt.title.toLowerCase().includes(promptSearchQuery.toLowerCase()) ||
          prompt.titleEn.toLowerCase().includes(promptSearchQuery.toLowerCase()) ||
          prompt.description.toLowerCase().includes(promptSearchQuery.toLowerCase()) ||
          prompt.tags.some((tag) => tag.toLowerCase().includes(promptSearchQuery.toLowerCase()))
      ),
    }))
    .filter((category) => category.prompts.length > 0);

  // 获取当前打开菜单的画布
  const menuCanvas = menuOpenId ? canvases.find((c) => c.id === menuOpenId) : null;

  return (
    <>
      <div className="flex h-full flex-shrink-0 z-40 relative shadow-xl shadow-base-300/20">
        {/* 最左侧图标导航栏 (Rail) */}
        <div className="w-[68px] flex flex-col items-center py-4 bg-base-100/80 backdrop-blur border-r border-base-300/50 gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = sidebarView === item.id;
            return (
              <button
                key={item.id}
                className={`
                relative group w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-300 cursor-pointer
                ${isActive
                    ? "bg-primary text-primary-content shadow-lg shadow-primary/30"
                    : "text-base-content/50 hover:bg-base-200 hover:text-base-content"
                  }
              `}
                title={item.label}
                onClick={() => setSidebarView(item.id)}
              >
                <Icon className={`w-5 h-5 transition-transform duration-300 ${isActive ? "scale-100" : "scale-90 group-hover:scale-100"}`} />

                {/* 活动指示器 (可选) */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full w-1 h-3 bg-primary rounded-r-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* 右侧内容面板 (Drawer) - 毛玻璃半透明背景 */}
        <div className="w-64 flex flex-col bg-base-100/60 backdrop-blur-md border-r border-base-300/40">

          {/* 画布视图 */}
          {sidebarView === "canvases" && (
            <>
              <div className="p-4 flex items-center justify-between sticky top-0 bg-transparent z-10">
                <button
                  className="flex items-center gap-1 font-bold text-base tracking-tight text-base-content/90 hover:text-primary transition-colors cursor-pointer"
                  onClick={() => setIsCanvasesExpanded(!isCanvasesExpanded)}
                >
                  <ChevronRight className={`w-4 h-4 transition-transform ${isCanvasesExpanded ? "rotate-90" : ""}`} />
                  我的画布
                </button>
                <button
                  className="btn btn-ghost btn-xs btn-circle hover:bg-base-content/10"
                  onClick={handleCreateCanvas}
                  title="新建画布"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div
                className={`flex-1 overflow-y-auto px-3 space-y-2 transition-all duration-300 ${isCanvasesExpanded ? "opacity-100" : "opacity-30 pointer-events-none"}`}
              >
                <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${isCanvasesExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <div className="overflow-hidden min-h-0">
                    {canvases.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-40 text-base-content/40 bg-base-200/30 rounded-xl border border-dashed border-base-300 mx-1">
                        <LayoutGrid className="w-8 h-8 mb-2 opacity-50" />
                        <p className="text-xs">暂无画布</p>
                        <button className="btn btn-primary btn-xs mt-3 shadow-md shadow-primary/20" onClick={handleCreateCanvas}>
                          新建画布
                        </button>
                      </div>
                    ) : (
                      canvases.map((canvas) => (
                        <div
                          key={canvas.id}
                          draggable={editingId !== canvas.id}
                          onDragStart={(e) => handleCanvasDragStart(e, canvas.id)}
                          onDragOver={(e) => handleCanvasDragOver(e, canvas.id)}
                          onDragEnd={handleCanvasDragEnd}
                          className={`
                          group relative flex items-center gap-3 p-3 rounded-xl
                          transition-all duration-200 border mb-2
                          ${draggingCanvasId === canvas.id ? "opacity-50 scale-95 border-dashed border-primary" : ""}
                          ${activeCanvasId === canvas.id
                              ? "bg-base-100 border-primary/30 shadow-md shadow-base-200"
                              : "bg-transparent border-transparent hover:bg-base-200/50 hover:border-base-200"
                            }
                          ${editingId === canvas.id ? "cursor-default" : "cursor-grab active:cursor-grabbing"}
                        `}
                          onClick={() => editingId !== canvas.id && switchCanvas(canvas.id)}
                        >
                          {/* 左侧状态条 OR 拖拽把手 (Hover 时显示把手) */}
                          <div className="relative w-1 h-8 flex items-center justify-center">
                            <div className={`w-1 h-8 rounded-full transition-all duration-200 ${activeCanvasId === canvas.id ? "bg-primary" : "bg-base-300"} group-hover:opacity-0`} />
                            <GripVertical className="absolute w-4 h-4 text-base-content/30 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>

                          {editingId === canvas.id ? (
                            <div className="flex-1 flex items-center gap-1 min-w-0">
                              <Input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveEdit();
                                  if (e.key === "Escape") cancelEdit();
                                }}
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                                className="h-8 text-sm"
                              />
                              <button className="btn btn-ghost btn-xs btn-circle text-success" onClick={(e) => { e.stopPropagation(); saveEdit(); }}><Check className="w-3.5 h-3.5" /></button>
                              <button className="btn btn-ghost btn-xs btn-circle text-base-content/50" onClick={(e) => { e.stopPropagation(); cancelEdit(); }}><X className="w-3.5 h-3.5" /></button>
                            </div>
                          ) : (
                            <>
                              <div className="flex-1 min-w-0 pointer-events-none">
                                <div className={`text-sm font-medium truncate ${activeCanvasId === canvas.id ? "text-primary" : "text-base-content/80"}`}>
                                  {canvas.name}
                                </div>
                                <div className="text-xs text-base-content/40 mt-0.5">
                                  {canvas.nodes.length} 个节点
                                </div>
                              </div>

                              <button
                                ref={(el) => { if (el) menuButtonRefs.current.set(canvas.id, el); }}
                                className={`
                                btn btn-ghost btn-xs btn-circle
                                transition-all duration-200
                                ${menuOpenId === canvas.id ? "opacity-100 bg-base-200" : "opacity-0 group-hover:opacity-100"}
                              `}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (menuOpenId === canvas.id) { setMenuOpenId(null); setMenuPosition(null); }
                                  else { openMenu(canvas.id); }
                                }}
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      ))
                    )}
                    <div className="h-5" /> {/* Bottom spacer */}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* 节点视图 */}
          {sidebarView === "nodes" && (
            <>
              <div className="p-4 pb-2 sticky top-0 bg-transparent z-10 backdrop-blur-xl">
                <h3 className="font-bold text-base tracking-tight mb-3 text-base-content/90 flex items-center gap-1">
                  节点库
                </h3>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/30" />
                  <input
                    type="text"
                    placeholder="搜索节点..."
                    className="w-full h-9 pl-9 pr-3 bg-base-200/50 border border-base-300/50 rounded-lg text-sm focus:outline-none focus:bg-base-100 focus:border-primary/30 transition-all placeholder:text-base-content/30"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-2 pb-6">
                {filteredCategories.map((category) => (
                  <div key={category.id} className="mb-4">
                    <button
                      className="flex items-center gap-2 w-full px-1 py-1 mb-1 text-xs font-bold text-base-content/40 uppercase tracking-wider hover:text-base-content/70 transition-colors cursor-pointer"
                      onClick={() => toggleCategory(category.id)}
                    >
                      <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedCategories.has(category.id) ? "rotate-90" : ""}`} />
                      <span>{category.name}</span>
                    </button>

                    <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${expandedCategories.has(category.id) ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                      <div className="overflow-hidden">
                        <div className="space-y-2 pt-1">
                          {category.nodes.map((node) => {
                            const IconComponent = nodeIconMap[node.icon];
                            const iconColorClass = nodeIconColors[node.icon] || "";
                            return (
                              <div
                                key={node.type}
                                className="draggable-node group flex items-start gap-3 p-3 bg-base-100 border border-base-200/60 rounded-xl hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 transition-all duration-200 cursor-grab active:cursor-grabbing relative overflow-hidden"
                                draggable
                                onDragStart={(e) => onDragStart(e, node.type, node.defaultData)}
                              >
                                {/* 悬停时的光效 */}
                                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-base-200/50 group-hover:bg-white group-hover:shadow-sm transition-all ${iconColorClass}`}>
                                  {IconComponent && <IconComponent className="w-5 h-5" />}
                                </div>
                                <div className="flex-1 min-w-0 z-10">
                                  <div className="text-sm font-medium text-base-content/90">{node.label}</div>
                                  <div className="text-xs text-base-content/50 leading-snug mt-0.5 line-clamp-2">
                                    {node.description}
                                  </div>
                                </div>
                                <GripVertical className="w-4 h-4 text-base-content/10 group-hover:text-base-content/30 self-center opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 提示词视图 */}
          {sidebarView === "prompts" && (
            <>
              <div className="p-4 pb-2 sticky top-0 bg-transparent z-10 backdrop-blur-xl">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-base tracking-tight text-base-content/90 flex items-center gap-1">
                    提示词库
                  </h3>
                  <button
                    className="btn btn-ghost btn-xs gap-1 text-primary hover:bg-primary/10"
                    onClick={() => {
                      setEditingUserPrompt(null);
                      setIsEditModalOpen(true);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    新建
                  </button>
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/30" />
                  <input
                    type="text"
                    placeholder="搜索提示词..."
                    className="w-full h-9 pl-9 pr-3 bg-base-200/50 border border-base-300/50 rounded-lg text-sm focus:outline-none focus:bg-base-100 focus:border-primary/30 transition-all placeholder:text-base-content/30"
                    value={promptSearchQuery}
                    onChange={(e) => setPromptSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-2 pb-6">
                {/* 用户自定义提示词 */}
                {userPrompts.length > 0 && (
                  <div className="mb-4">
                    <button
                      className="flex items-center gap-2 w-full px-1 py-1 mb-1 text-xs font-bold text-base-content/40 uppercase tracking-wider hover:text-base-content/70 transition-colors cursor-pointer"
                      onClick={() => setIsUserPromptsExpanded(!isUserPromptsExpanded)}
                    >
                      <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${isUserPromptsExpanded ? "rotate-90" : ""}`} />
                      <span className="flex items-center gap-1.5"><User className="w-3 h-3" /> 我的提示词</span>
                    </button>

                    <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${isUserPromptsExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                      <div className="overflow-hidden">
                        <div className="space-y-2 pt-1">
                          {userPrompts
                            .filter((p) => !promptSearchQuery || p.title.toLowerCase().includes(promptSearchQuery.toLowerCase()))
                            .map((userPrompt) => (
                              <div
                                key={userPrompt.id}
                                className="draggable-prompt group relative p-3 bg-base-100 border border-base-200/60 rounded-xl hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 transition-all duration-200 cursor-grab active:cursor-grabbing"
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData("application/reactflow/prompt-template", JSON.stringify({ promptText: userPrompt.prompt, template: userPrompt.nodeTemplate }));
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                              >
                                <div className="flex justify-between items-start mb-1">
                                  <div className="font-medium text-sm text-base-content/90 line-clamp-1">{userPrompt.title}</div>
                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button className="p-1 hover:bg-base-200 rounded text-base-content/60" onClick={(e) => { e.stopPropagation(); setPreviewPrompt({ ...userPrompt } as any); setIsPreviewModalOpen(true); }}><Eye className="w-3 h-3" /></button>
                                    <button className="p-1 hover:bg-base-200 rounded text-base-content/60" onClick={(e) => { e.stopPropagation(); setEditingUserPrompt(userPrompt); setIsEditModalOpen(true); }}><Edit3 className="w-3 h-3" /></button>
                                    <button className="p-1 hover:bg-error/10 rounded text-error" onClick={(e) => { e.stopPropagation(); if (confirm("删除?")) deletePrompt(userPrompt.id); }}><Trash2 className="w-3 h-3" /></button>
                                  </div>
                                </div>
                                <div className="text-xs text-base-content/50 line-clamp-2 leading-relaxed">{userPrompt.description || userPrompt.prompt}</div>
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 系统提示词 */}
                {filteredPromptCategories.map((category) => {
                  const CategoryIcon = promptIconMap[category.icon];
                  return (
                    <div key={category.id} className="mb-4">
                      <button
                        className="flex items-center gap-2 w-full px-1 py-1 mb-1 text-xs font-bold text-base-content/40 uppercase tracking-wider hover:text-base-content/70 transition-colors cursor-pointer"
                        onClick={() => togglePromptCategory(category.id)}
                      >
                        <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedPromptCategories.has(category.id) ? "rotate-90" : ""}`} />
                        {CategoryIcon && <CategoryIcon className="w-3 h-3" />}
                        <span>{category.name}</span>
                      </button>

                      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${expandedPromptCategories.has(category.id) ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                        <div className="overflow-hidden">
                          <div className="space-y-2 pt-1">
                            {category.prompts.map((prompt) => (
                              <div
                                key={prompt.id}
                                className="draggable-prompt group p-3 bg-base-100 border border-base-200/60 rounded-xl hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 transition-all duration-200 cursor-grab active:cursor-grabbing"
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData("application/reactflow/prompt-template", JSON.stringify({ promptText: prompt.prompt, template: prompt.nodeTemplate }));
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                              >
                                <div className="flex justify-between items-start mb-1">
                                  <div className="font-medium text-sm text-base-content/90 line-clamp-1">{prompt.title}</div>
                                  <button className="p-1 -mr-1 -mt-1 hover:bg-base-200 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); openPromptPreview(prompt); }}>
                                    <Eye className="w-3.5 h-3.5 text-base-content/50" />
                                  </button>
                                </div>
                                <div className="text-xs text-base-content/50 line-clamp-2 leading-relaxed">{prompt.description}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Context Menu Portal */}
      {menuOpenId && menuPosition && menuCanvas && createPortal(
        <ul
          className="canvas-context-menu menu bg-base-100/95 backdrop-blur rounded-xl w-36 p-1.5 shadow-float border border-base-200 fixed z-[9999]"
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          <li><button onClick={(e) => { e.stopPropagation(); startEditing(menuCanvas.id, menuCanvas.name); }}><Edit3 className="w-4 h-4" /> 重命名</button></li>
          <li><button onClick={(e) => { e.stopPropagation(); handleDuplicate(menuCanvas.id); }}><Copy className="w-4 h-4" /> 复制</button></li>
          <div className="divider my-1 h-px bg-base-200/50" />
          <li><button className="text-error hover:bg-error/10" onClick={(e) => { e.stopPropagation(); handleDelete(menuCanvas.id); }}><Trash2 className="w-4 h-4" /> 删除</button></li>
        </ul>,
        document.body
      )}

      <PromptPreviewModal prompt={previewPrompt} isOpen={isPreviewModalOpen} onClose={closePromptPreview} />
      <PromptEditModal isOpen={isEditModalOpen} onClose={() => { setIsEditModalOpen(false); setEditingUserPrompt(null); }} onSave={(input) => { if (editingUserPrompt) { updatePrompt(editingUserPrompt.id, input); } else { addPrompt(input); } }} editingPrompt={editingUserPrompt} />
    </>
  );
}
