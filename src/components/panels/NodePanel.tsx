import { useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Search,
  GripVertical,
} from "lucide-react";
import { nodeCategories, nodeIconMap, nodeIconColors } from "@/config/nodeConfig";

interface NodePanelProps {
  onDragStart: (event: React.DragEvent, nodeType: string, defaultData: Record<string, unknown>) => void;
}

export function NodePanel({ onDragStart }: NodePanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(nodeCategories.map((c) => c.id))
  );

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

  return (
    <div className="flex flex-col h-full bg-base-100 border-r border-base-300">
      {/* 头部 */}
      <div className="p-4 border-b border-base-300">
        <h2 className="text-lg font-semibold mb-3">节点库</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40" />
          <input
            type="text"
            placeholder="搜索节点..."
            className="input input-bordered input-sm w-full pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 节点列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredCategories.map((category) => (
          <div key={category.id} className="mb-2">
            {/* 分类标题 */}
            <button
              className="flex items-center gap-2 w-full px-2 py-1.5 text-sm font-medium text-base-content/70 hover:text-base-content hover:bg-base-200 rounded-lg transition-colors"
              onClick={() => toggleCategory(category.id)}
            >
              {expandedCategories.has(category.id) ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              <span>{category.name}</span>
              <span className="text-xs text-base-content/40 ml-auto">
                {category.nodes.length}
              </span>
            </button>

            {/* 节点项 */}
            {expandedCategories.has(category.id) && (
              <div className="mt-1 space-y-1">
                {category.nodes.map((node) => {
                  const IconComponent = nodeIconMap[node.icon];
                  const iconColorClass = nodeIconColors[node.icon] || "";
                  return (
                    <div
                      key={node.type}
                      className="draggable-node flex items-center gap-3 px-3 py-2.5 bg-base-200/50 hover:bg-base-200 rounded-lg transition-colors group"
                      draggable
                      onDragStart={(e) => onDragStart(e, node.type, node.defaultData)}
                    >
                      <GripVertical className="w-4 h-4 text-base-content/30 group-hover:text-base-content/50" />
                      <div className={`p-1.5 rounded-lg ${iconColorClass}`}>
                        {IconComponent && <IconComponent className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{node.label}</div>
                        <div className="text-xs text-base-content/50 truncate">
                          {node.description}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 底部提示 */}
      <div className="p-3 border-t border-base-300">
        <p className="text-xs text-base-content/40 text-center">
          拖拽节点到画布中使用
        </p>
      </div>
    </div>
  );
}
