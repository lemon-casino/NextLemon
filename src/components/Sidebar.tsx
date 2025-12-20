import { useState, useCallback } from "react";
import {
  LayoutGrid,
  Blocks,
  Plus,
  Trash2,
  Check,
  X,
  BookText,
  User,
} from "lucide-react";
import { useCanvasStore, type SidebarView } from "@/stores/canvasStore";
import { useUserPromptStore, type UserPrompt, type CreatePromptInput } from "@/stores/userPromptStore";
import { nodeCategories, nodeIconMap, nodeIconColors } from "@/config/nodeConfig";
import { promptCategories, type PromptItem } from "@/config/promptConfig";
import { Input } from "@/components/ui/Input";
import { PromptPreviewModal } from "@/components/ui/PromptPreviewModal";
import { PromptEditModal } from "@/components/ui/PromptEditModal";

// Navigation Items
const navItems: { id: SidebarView; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { id: "canvases", icon: LayoutGrid, label: "Canvases" },
  { id: "nodes", icon: Blocks, label: "Nodes" },
  { id: "prompts", icon: BookText, label: "Prompts" },
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
  } = useCanvasStore();

  // Canvas State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  // Context menu state removed as it was unused and causing lint errors

  // Node Panel State
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(nodeCategories.map((c) => c.id))
  );

  // Prompt Panel State
  const [promptSearchQuery, setPromptSearchQuery] = useState("");
  const [expandedPromptCategories, setExpandedPromptCategories] = useState<Set<string>>(
    new Set(promptCategories.map((c) => c.id))
  );
  const [previewPrompt, setPreviewPrompt] = useState<PromptItem | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);

  // User Custom Prompts
  const { prompts: userPrompts, addPrompt, updatePrompt, deletePrompt } = useUserPromptStore();
  const [isUserPromptsExpanded, setIsUserPromptsExpanded] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingUserPrompt, setEditingUserPrompt] = useState<UserPrompt | null>(null);

  // Canvas Operations
  const startEditing = useCallback((id: string, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
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
  }, [deleteCanvas]);

  const handleCreateCanvas = useCallback(() => {
    createCanvas();
  }, [createCanvas]);

  // Node Panel Operations
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

  // Prompt Panel Operations
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

  const openPromptPreview = useCallback((prompt: PromptItem) => {
    setPreviewPrompt(prompt);
    setIsPreviewModalOpen(true);
  }, []);

  const closePromptPreview = useCallback(() => {
    setIsPreviewModalOpen(false);
  }, []);

  // Filter Nodes
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

  // Filter Prompts
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

  return (
    <>
      <div className="flex h-full flex-shrink-0 gap-3 pl-4">
        {/* Left Icon Navigation - Floating Glass Strip */}
        <div className="w-16 flex flex-col items-center py-4 glass-panel rounded-2xl h-fit border border-white/5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = sidebarView === item.id;
            return (
              <button
                key={item.id}
                className={`
                  w-10 h-10 flex items-center justify-center rounded-xl mb-3
                  transition-all duration-300
                  ${isActive
                    ? "bg-primary text-primary-content shadow-[0_0_15px_-3px_var(--color-primary)] scale-110"
                    : "text-white/60 hover:bg-white/10 hover:text-white hover:scale-105"
                  }
                `}
                onClick={() => setSidebarView(item.id)}
                title={item.label}
              >
                <Icon className="w-5 h-5" />
              </button>
            );
          })}
        </div>

        {/* Right Content Panel - Floating Glass Panel */}
        <div className="w-64 flex flex-col glass-panel rounded-2xl overflow-hidden h-full animate-fade-in border border-white/5">
          {/* Canvases View */}
          {sidebarView === "canvases" && (
            <>
              {/* Header */}
              <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                <h3 className="font-bold text-sm tracking-wide text-white">My Canvases</h3>
                <button
                  className="glass-btn btn-xs btn-circle bg-white/5 hover:bg-white/10 text-white border-white/10"
                  onClick={handleCreateCanvas}
                  title="New Canvas"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Canvas List */}
              <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                {canvases.length === 0 ? (
                  <div className="text-center py-12 text-white/40">
                    <LayoutGrid className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-xs">No canvases found</p>
                    <button
                      className="btn btn-primary btn-xs mt-4"
                      onClick={handleCreateCanvas}
                    >
                      Create Canvas
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {canvases.map((canvas) => (
                      <div
                        key={canvas.id}
                        className={`
                          group relative flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer
                          transition-all duration-200 border border-transparent
                          ${activeCanvasId === canvas.id
                            ? "bg-primary/20 border-primary/30 text-primary shadow-sm"
                            : "hover:bg-white/5 hover:border-white/10 text-white/80"
                          }
                        `}
                        onClick={() => editingId !== canvas.id && switchCanvas(canvas.id)}
                      >
                        {editingId === canvas.id ? (
                          <div className="flex-1 flex items-center gap-1">
                            <Input
                              value={editName}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditName(e.target.value)}
                              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                if (e.key === "Enter") saveEdit();
                                if (e.key === "Escape") cancelEdit();
                              }}
                              autoFocus
                              className="h-7 text-xs bg-black/20 border-white/10 text-white"
                              onBlur={saveEdit}
                            />
                            <button
                              className="btn btn-ghost btn-xs btn-square text-success hover:bg-success/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                saveEdit();
                              }}
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              className="btn btn-ghost btn-xs btn-square text-error hover:bg-error/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelEdit();
                              }}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">{canvas.name}</div>
                              <div className="text-[10px] opacity-60 truncate">
                                {new Date(canvas.updatedAt).toLocaleDateString()}
                              </div>
                            </div>

                            {/* Actions Group - Visible on Hover or Active */}
                            <div className={`flex items-center gap-1 ${activeCanvasId === canvas.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity`}>
                              <button
                                className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEditing(canvas.id, canvas.name);
                                }}
                                title="Rename"
                              >
                                {/* Edit Icon */}
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                              </button>
                              <button
                                className="p-1 rounded hover:bg-error/20 text-white/60 hover:text-error transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(canvas.id);
                                }}
                                title="Delete"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Nodes View */}
          {sidebarView === "nodes" && (
            <>
              <div className="p-4 border-b border-white/5 bg-white/5">
                <Input
                  placeholder="Search Component Nodes..."
                  value={searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                  className="bg-black/20 border-white/10 text-white placeholder:text-white/30 focus:border-primary/50"
                  leftIcon={
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                  }
                />
              </div>

              <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                <div className="space-y-4">
                  {filteredCategories.map((category) => (
                    <div key={category.id} className="space-y-2">
                      {/* Category Header */}
                      <button
                        className="flex items-center gap-2 w-full text-left text-xs font-semibold text-white/40 uppercase tracking-wider hover:text-white/60 transition-colors"
                        onClick={() => toggleCategory(category.id)}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`transition-transform duration-200 ${expandedCategories.has(category.id) ? "rotate-90" : ""}`}
                        >
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                        {category.name}
                      </button>

                      {/* Nodes Grid */}
                      {expandedCategories.has(category.id) && (
                        <div className="grid grid-cols-2 gap-2 animate-in slide-in-from-top-2 duration-200">
                          {category.nodes.map((node) => {
                            const Icon = nodeIconMap[node.type] || Blocks;
                            const colorClass = nodeIconColors[node.type] || "text-base-content";

                            return (
                              <div
                                key={node.type}
                                className="flex flex-col items-center justify-center p-3 rounded-xl bg-white/5 border border-white/5 cursor-grab hover:bg-white/10 hover:border-white/10 hover:shadow-lg hover:-translate-y-0.5 transition-all active:cursor-grabbing"
                                draggable
                                onDragStart={(e: React.DragEvent) => onDragStart(e, node.type, node.defaultData)}
                              >
                                <div className={`mb-2 p-2 rounded-lg bg-black/20 ${colorClass}`}>
                                  <Icon className="w-6 h-6" />
                                </div>
                                <span className="text-xs font-medium text-white/90 text-center leading-tight">
                                  {node.label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Prompts View */}
          {sidebarView === "prompts" && (
            <>
              <div className="p-4 border-b border-white/5 bg-white/5">
                <Input
                  placeholder="Search Prompts..."
                  value={promptSearchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPromptSearchQuery(e.target.value)}
                  className="bg-black/20 border-white/10 text-white placeholder:text-white/30 focus:border-primary/50"
                  leftIcon={
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                  }
                />
              </div>

              <div className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-4">
                {/* User Custom Prompts Section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <button
                      className="flex items-center gap-2 text-xs font-semibold text-white/40 uppercase tracking-wider hover:text-white/60 transition-colors"
                      onClick={() => setIsUserPromptsExpanded(!isUserPromptsExpanded)}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`transition-transform duration-200 ${isUserPromptsExpanded ? "rotate-90" : ""}`}
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                      My Prompts
                    </button>
                    <button
                      className="glass-btn btn-xs btn-square bg-white/5 hover:bg-white/10 text-white/60 hover:text-white"
                      onClick={() => {
                        setEditingUserPrompt(null);
                        setIsEditModalOpen(true);
                      }}
                      title="Add Custom Prompt"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {isUserPromptsExpanded && (
                    <div className="space-y-2">
                      {userPrompts.length === 0 ? (
                        <div className="text-center py-4 bg-white/5 rounded-lg border border-dashed border-white/10">
                          <p className="text-xs text-white/30">No custom prompts</p>
                        </div>
                      ) : (
                        userPrompts.map(prompt => (
                          <div
                            key={prompt.id}
                            className="group relative p-2 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-colors cursor-grab active:cursor-grabbing"
                            draggable
                            onDragStart={(e: React.DragEvent) => onDragStart(e, "llm", {
                              title: prompt.title, // Map to Node Data
                              prompt: prompt.prompt
                            })}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <div className="p-1 rounded bg-primary/20 text-primary">
                                  <User className="w-3 h-3" />
                                </div>
                                <span className="text-sm font-medium text-white/90 truncate max-w-[120px]">{prompt.title}</span>
                              </div>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  className="p-1 hover:text-white text-white/50"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingUserPrompt(prompt);
                                    setIsEditModalOpen(true);
                                  }}
                                >
                                  {/* Edit Icon Small */}
                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                                </button>
                                <button
                                  className="p-1 hover:text-error text-white/50"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deletePrompt(prompt.id);
                                  }}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-white/50 mt-1 line-clamp-2">{prompt.prompt}</p>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* System Prompts Categories */}
                {filteredPromptCategories.map((category) => (
                  <div key={category.id} className="space-y-2">
                    <button
                      className="flex items-center gap-2 w-full text-left text-xs font-semibold text-white/40 uppercase tracking-wider hover:text-white/60 transition-colors"
                      onClick={() => togglePromptCategory(category.id)}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`transition-transform duration-200 ${expandedPromptCategories.has(category.id) ? "rotate-90" : ""}`}
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                      {category.nameEn}
                    </button>

                    {expandedPromptCategories.has(category.id) && (
                      <div className="space-y-2 animate-in slide-in-from-top-1 duration-200">
                        {category.prompts.map((prompt) => (
                          <div
                            key={prompt.id}
                            className="group p-2 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-colors cursor-grab active:cursor-grabbing"
                            draggable
                            onDragStart={(e: React.DragEvent) => onDragStart(e, "llm", {
                              title: prompt.title,
                              prompt: prompt.prompt
                            })}
                            onClick={() => openPromptPreview(prompt)}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-white/90">{prompt.title}</span>
                              {/* Preview Icon */}
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity text-white/40">
                                {/* Eye Icon */}
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                              </div>
                            </div>
                            <p className="text-xs text-white/50 line-clamp-2">{prompt.description}</p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {prompt.tags.slice(0, 3).map(tag => (
                                <span key={tag} className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-white/40 border border-white/5">{tag}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Prompt Preview Modal */}
      {previewPrompt && (
        <PromptPreviewModal
          isOpen={isPreviewModalOpen}
          onClose={closePromptPreview}
          prompt={previewPrompt}
        />
      )}

      {/* User Prompt Edit Modal */}
      {isEditModalOpen && (
        <PromptEditModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          editingPrompt={editingUserPrompt || null}
          onSave={(data: CreatePromptInput) => {
            if (editingUserPrompt) {
              updatePrompt(editingUserPrompt.id, data);
            } else {
              addPrompt(data);
            }
            setIsEditModalOpen(false);
          }}
        />
      )}
    </>
  );
}
