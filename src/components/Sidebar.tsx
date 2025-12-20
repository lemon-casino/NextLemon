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
  Settings,
} from "lucide-react";
import { useCanvasStore, type SidebarView } from "@/stores/canvasStore";
import { useUserPromptStore, type UserPrompt, type CreatePromptInput } from "@/stores/userPromptStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { nodeCategories, nodeIconMap, nodeIconColors } from "@/config/nodeConfig";
import { promptCategories, promptIconMap, promptIconColors, type PromptItem } from "@/config/promptConfig";
import { Input } from "@/components/ui/Input";
import { PromptPreviewModal } from "@/components/ui/PromptPreviewModal";
import { PromptEditModal } from "@/components/ui/PromptEditModal";

// 导航项定义
const navItems: { id: SidebarView; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { id: "canvases", icon: LayoutGrid, label: "画布" },
  { id: "nodes", icon: Blocks, label: "节点" },
  { id: "prompts", icon: BookText, label: "提示词" },
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
  } = useCanvasStore();

  const { openSettings } = useSettingsStore();

  // ... (rest of the state and handlers remain same) ...

  // ... (inside return) ...

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

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
      <div className="absolute left-4 top-24 bottom-4 z-40 flex items-start gap-3 pointer-events-none">
        {/* 独立图标轨 Rail - 漂浮玻璃面板 */}
        <div className="pointer-events-auto w-16 h-full flex flex-col items-center py-4 bg-base-100/60 backdrop-blur-md border border-base-200/50 rounded-2xl shadow-xl">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = sidebarView === item.id;
            return (
              <div key={item.id} className="relative group w-full flex justify-center mb-3">
                {/* 选中指示条 */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full shadow-[0_0_10px_theme(colors.primary)]" />
                )}
                <button
                  className={`
                  w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-300 cursor-pointer
                  ${isActive
                      ? "bg-primary text-primary-content shadow-lg scale-105"
                      : "hover:bg-base-100/80 text-base-content/60 hover:text-base-content hover:shadow-md hover:scale-105"
                    }
                `}
                  data-tip={item.label}
                  onClick={() => setSidebarView(isActive ? null : item.id)}
                >
                  <Icon className={`w-5 h-5 transition-transform duration-300 ${isActive ? "scale-110" : "group-hover:scale-110"}`} />
                </button>
              </div>
            );
          })}

          {/* 底部设置按钮 */}
          <div className="mt-auto relative group w-full flex justify-center">
            <button
              className="w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-300 cursor-pointer hover:bg-base-100/80 text-base-content/60 hover:text-base-content hover:shadow-md hover:scale-105"
              data-tip="设置"
              onClick={openSettings}
            >
              <Settings className="w-5 h-5 transition-transform duration-500 group-hover:rotate-90" />
            </button>
          </div>
        </div>

        {/* 内容抽屉 Drawer - 漂浮玻璃面板 */}
        <div
          className={`
          pointer-events-auto w-72 h-full flex flex-col bg-base-100/60 backdrop-blur-md border border-base-200/50 rounded-2xl shadow-xl overflow-hidden
          transition-all duration-300 ease-spring
          ${sidebarView ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0 pointer-events-none'}
        `}
        >
          {/* 画布视图 */}
          {sidebarView === "canvases" && (
            <>
              {/* 头部 */}
              <div className="p-4 border-b border-base-content/5 flex items-center justify-between bg-base-100/30">
                <h3 className="font-semibold text-lg tracking-tight">我的画布</h3>
                <button
                  className="btn btn-ghost btn-xs btn-circle hover:bg-white/20"
                  onClick={handleCreateCanvas}
                  title="新建画布"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>

              {/* 画布列表 - 卡片式 */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                {canvases.length === 0 ? (
                  <div className="text-center py-10 text-base-content/50 flex flex-col items-center">
                    <div className="w-16 h-16 rounded-2xl bg-base-content/5 flex items-center justify-center mb-3">
                      <LayoutGrid className="w-8 h-8 opacity-40" />
                    </div>
                    <p className="text-sm">暂无画布</p>
                    <button
                      className="btn btn-primary btn-sm mt-4 shadow-lg shadow-primary/20"
                      onClick={handleCreateCanvas}
                    >
                      新建画布
                    </button>
                  </div>
                ) : (
                  canvases.map((canvas) => (
                    <div
                      key={canvas.id}
                      className={`
                        group relative flex items-center gap-3 p-3 rounded-xl cursor-pointer
                        transition-all duration-200 border
                        ${activeCanvasId === canvas.id
                          ? "bg-primary/10 border-primary/20 shadow-sm"
                          : "bg-base-100/40 border-transparent hover:bg-base-100/80 hover:shadow-md hover:border-base-content/5"
                        }
                      `}
                      onClick={() => editingId !== canvas.id && switchCanvas(canvas.id)}
                    >
                      {editingId === canvas.id ? (
                        <div className="flex-1 flex items-center gap-1">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 min-w-0 h-8 text-sm"
                          />
                          <button className="btn btn-ghost btn-xs btn-circle" onClick={(e) => { e.stopPropagation(); saveEdit(); }}><Check className="w-3.5 h-3.5 text-success" /></button>
                          <button className="btn btn-ghost btn-xs btn-circle" onClick={(e) => { e.stopPropagation(); cancelEdit(); }}><X className="w-3.5 h-3.5 text-base-content/50" /></button>
                        </div>
                      ) : (
                        <>
                          <div className={`
                            w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors
                            ${activeCanvasId === canvas.id ? "bg-primary text-primary-content shadow-sm" : "bg-base-200 text-base-content/50 group-hover:bg-base-300"}
                          `}>
                            <LayoutGrid className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium truncate transition-colors ${activeCanvasId === canvas.id ? "text-primary" : "text-base-content/80"}`}>
                              {canvas.name}
                            </div>
                            <div className="text-xs text-base-content/40 flex items-center gap-1">
                              <span>{canvas.nodes.length} 个节点</span>
                              <span className="w-0.5 h-0.5 rounded-full bg-base-content/30" />
                              <span>{new Date(canvas.updatedAt).toLocaleDateString()}</span>
                            </div>
                          </div>

                          <button
                            ref={(el) => { if (el) menuButtonRefs.current.set(canvas.id, el); }}
                            className={`
                              btn btn-ghost btn-xs btn-circle
                              ${menuOpenId === canvas.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
                              transition-all
                            `}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (menuOpenId === canvas.id) {
                                setMenuOpenId(null);
                                setMenuPosition(null);
                              } else {
                                openMenu(canvas.id);
                              }
                            }}
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* 节点视图 */}
          {sidebarView === "nodes" && (
            <>
              <div className="p-4 border-b border-base-content/5 bg-base-100/30">
                <h3 className="font-semibold text-lg tracking-tight mb-3">节点库</h3>
                <Input
                  isSearch
                  placeholder="搜索节点..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-base-100/50 backdrop-blur-sm shadow-inner"
                />
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar">
                {filteredCategories.map((category) => (
                  <div key={category.id}>
                    <button
                      className="flex items-center gap-2 w-full px-2 py-1.5 mb-2 text-sm font-semibold text-base-content/60 hover:text-base-content transition-colors"
                      onClick={() => toggleCategory(category.id)}
                    >
                      <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${expandedCategories.has(category.id) ? "rotate-90" : ""}`} />
                      <span>{category.name}</span>
                    </button>

                    <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${expandedCategories.has(category.id) ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                      <div className="overflow-hidden">
                        <div className="grid grid-cols-1 gap-2 p-1">
                          {category.nodes.map((node) => {
                            const IconComponent = nodeIconMap[node.icon];
                            const iconColorClass = nodeIconColors[node.icon] || "";
                            return (
                              <div
                                key={node.type}
                                className="draggable-node group flex items-start gap-3 p-3 bg-base-100/40 hover:bg-base-100/90 border border-transparent hover:border-base-content/5 hover:shadow-md rounded-xl transition-all cursor-grab active:cursor-grabbing"
                                draggable
                                onDragStart={(e) => onDragStart(e, node.type, node.defaultData)}
                              >
                                <div className={`p-2 rounded-lg shadow-sm flex-shrink-0 ${iconColorClass} bg-opacity-10 dark:bg-opacity-20`}>
                                  {IconComponent && <IconComponent className="w-5 h-5" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium leading-none mb-1.5 group-hover:text-primary transition-colors">{node.label}</div>
                                  <div className="text-xs text-base-content/50 leading-tight line-clamp-2">
                                    {node.description}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3 border-t border-base-content/5 text-center bg-base-100/30">
                <p className="text-xs text-base-content/40">
                  拖拽节点到画布中使用
                </p>
              </div>
            </>
          )}

          {/* 提示词视图 */}
          {sidebarView === "prompts" && (
            <>
              <div className="p-4 border-b border-base-content/5 bg-base-100/30">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-lg tracking-tight">提示词库</h3>
                  <button
                    className="btn btn-primary btn-xs gap-1 shadow-md shadow-primary/20"
                    onClick={() => {
                      setEditingUserPrompt(null);
                      setIsEditModalOpen(true);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    新建
                  </button>
                </div>
                <Input
                  isSearch
                  placeholder="搜索提示词..."
                  value={promptSearchQuery}
                  onChange={(e) => setPromptSearchQuery(e.target.value)}
                  className="bg-base-100/50 backdrop-blur-sm shadow-inner"
                />
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar">
                {/* 用户提示词 */}
                {userPrompts.length > 0 && (
                  <div>
                    <button
                      className="flex items-center gap-2 w-full px-2 py-1.5 mb-2 text-sm font-semibold text-primary hover:text-primary-focus transition-colors"
                      onClick={() => setIsUserPromptsExpanded(!isUserPromptsExpanded)}
                    >
                      <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${isUserPromptsExpanded ? "rotate-90" : ""}`} />
                      <User className="w-3.5 h-3.5" />
                      <span className="truncate">我的提示词</span>
                      <span className="badge badge-sm badge-primary badge-outline ml-auto">{userPrompts.length}</span>
                    </button>

                    <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${isUserPromptsExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                      <div className="overflow-hidden">
                        <div className="grid grid-cols-1 gap-2 p-1">
                          {userPrompts
                            .filter(p => !promptSearchQuery || p.title.toLowerCase().includes(promptSearchQuery.toLowerCase()))
                            .map((userPrompt) => (
                              <div
                                key={userPrompt.id}
                                className="draggable-prompt group relative p-3 bg-base-100/40 hover:bg-base-100/90 border border-transparent hover:border-base-content/5 hover:shadow-md rounded-xl transition-all cursor-grab"
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData("application/reactflow/prompt-template", JSON.stringify({ promptText: userPrompt.prompt, template: userPrompt.nodeTemplate }));
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                              >
                                <div className="flex items-start gap-3">
                                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-bold text-xs shadow-md">
                                    {userPrompt.title.slice(0, 1).toUpperCase()}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium mb-1 truncate">{userPrompt.title}</div>
                                    <div className="text-xs text-base-content/50 line-clamp-2">{userPrompt.description || userPrompt.prompt}</div>
                                  </div>
                                </div>
                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-base-100/80 backdrop-blur rounded-full p-1 shadow-sm">
                                  <button className="p-1 hover:text-primary transition-colors" onClick={(e) => { e.stopPropagation(); setPreviewPrompt({ ...userPrompt } as any); setIsPreviewModalOpen(true); }}><Eye className="w-3.5 h-3.5" /></button>
                                  <button className="p-1 hover:text-primary transition-colors" onClick={(e) => { e.stopPropagation(); setEditingUserPrompt(userPrompt); setIsEditModalOpen(true); }}><Edit3 className="w-3.5 h-3.5" /></button>
                                  <button className="p-1 hover:text-error transition-colors" onClick={(e) => { e.stopPropagation(); if (confirm("确认删除?")) deletePrompt(userPrompt.id); }}><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
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
                  const categoryColorClass = promptIconColors[category.icon] || "";
                  return (
                    <div key={category.id}>
                      <button
                        className="flex items-center gap-2 w-full px-2 py-1.5 mb-2 text-sm font-semibold text-base-content/60 hover:text-base-content transition-colors"
                        onClick={() => togglePromptCategory(category.id)}
                      >
                        <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${expandedPromptCategories.has(category.id) ? "rotate-90" : ""}`} />
                        <div className={`p-1 rounded ${categoryColorClass} bg-opacity-20`}>
                          {CategoryIcon && <CategoryIcon className="w-3.5 h-3.5" />}
                        </div>
                        <span>{category.name}</span>
                      </button>

                      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${expandedPromptCategories.has(category.id) ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                        <div className="overflow-hidden">
                          <div className="grid grid-cols-1 gap-2 p-1">
                            {category.prompts.map((prompt) => (
                              <div
                                key={prompt.id}
                                className="draggable-prompt group flex items-start gap-3 p-3 bg-base-100/40 hover:bg-base-100/90 border border-transparent hover:border-base-content/5 hover:shadow-md rounded-xl transition-all cursor-grab"
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData("application/reactflow/prompt-template", JSON.stringify({ promptText: prompt.prompt, template: prompt.nodeTemplate }));
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="text-sm font-medium truncate">{prompt.title}</div>
                                    <button className="opacity-0 group-hover:opacity-100 p-1 hover:bg-base-200 rounded-full transition-all" onClick={(e) => { e.stopPropagation(); openPromptPreview(prompt); }}><Eye className="w-3.5 h-3.5 text-base-content/60" /></button>
                                  </div>
                                  <div className="text-xs text-base-content/50 line-clamp-2">{prompt.description}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Context Menu Portal code remains same but updated z-index if needed (already 9999) */}
      {/* ... Modal code ... */}
      {menuOpenId && menuPosition && menuCanvas && createPortal(
        <ul
          className="canvas-context-menu menu bg-base-100/80 backdrop-blur-md rounded-xl w-32 p-1 shadow-lg border border-base-200/50 fixed z-[9999]"
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          <li><button onClick={(e) => { e.stopPropagation(); startEditing(menuCanvas.id, menuCanvas.name); }}><Edit3 className="w-4 h-4" />重命名</button></li>
          <li><button onClick={(e) => { e.stopPropagation(); handleDuplicate(menuCanvas.id); }}><Copy className="w-4 h-4" />复制</button></li>
          <li><button className="text-error" onClick={(e) => { e.stopPropagation(); handleDelete(menuCanvas.id); }}><Trash2 className="w-4 h-4" />删除</button></li>
        </ul>,
        document.body
      )}

      <PromptPreviewModal prompt={previewPrompt} isOpen={isPreviewModalOpen} onClose={closePromptPreview} />
      <PromptEditModal isOpen={isEditModalOpen} onClose={() => { setIsEditModalOpen(false); setEditingUserPrompt(null); }} onSave={(input) => { if (editingUserPrompt) { updatePrompt(editingUserPrompt.id, input); } else { addPrompt(input); } }} editingPrompt={editingUserPrompt} />
    </>
  );
}
