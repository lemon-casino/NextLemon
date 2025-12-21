import { Keyboard } from "lucide-react";

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}



export function KeyboardShortcutsContent() {
  const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const cmdKey = isMac ? "⌘" : "Ctrl";

  const shortcutGroups: ShortcutGroup[] = [
    {
      title: "基本操作",
      shortcuts: [
        { keys: ["Delete", "Backspace"], description: "删除选中的节点或连线" },
        { keys: [`${cmdKey}`, "C"], description: "复制选中的节点" },
        { keys: [`${cmdKey}`, "V"], description: "粘贴节点" },
        { keys: [`${cmdKey}`, "D"], description: "创建选中节点的副本" },
        { keys: [`${cmdKey}`, "A"], description: "全选所有节点" },
        { keys: ["Esc"], description: "取消选择" },
      ],
    },
    {
      title: "撤销与重做",
      shortcuts: [
        { keys: [`${cmdKey}`, "Z"], description: "撤销上一步操作" },
        { keys: [`${cmdKey}`, "Shift", "Z"], description: "重做操作" },
      ],
    },
    {
      title: "布局与整理",
      shortcuts: [
        { keys: [`${cmdKey}`, "O"], description: "自动整理节点布局" },
      ],
    },
    {
      title: "多选操作",
      shortcuts: [
        { keys: [`${cmdKey}`, "单击"], description: "添加/移除节点到选区" },
        { keys: ["Shift", "单击"], description: "添加/移除节点到选区" },
        { keys: ["拖拽框选"], description: "框选多个节点" },
      ],
    },
    {
      title: "画布导航",
      shortcuts: [
        { keys: ["鼠标滚轮"], description: "缩放画布" },
        { keys: ["鼠标中键拖拽"], description: "平移画布" },
        { keys: ["右键拖拽"], description: "平移画布" },
      ],
    },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center px-6 py-4 border-b border-base-300 gap-2">
        <Keyboard className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">键盘快捷键</h2>
      </div>
      <div className="p-6 overflow-y-auto flex-1">

        <div className="space-y-6">
          {shortcutGroups.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-medium text-base-content/60 mb-3">
                {group.title}
              </h3>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="text-sm">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, keyIndex) => (
                        <span key={keyIndex} className="flex items-center gap-1">
                          <kbd className="kbd kbd-sm bg-base-200">
                            {key}
                          </kbd>
                          {keyIndex < shortcut.keys.length - 1 && (
                            <span className="text-base-content/40">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 提示 */}
        <div className="mt-6 pt-4 border-t border-base-300">
          <p className="text-xs text-base-content/50 text-center">
            按 <kbd className="kbd kbd-xs">Esc</kbd> 或 <kbd className="kbd kbd-xs">?</kbd> 关闭此面板
          </p>
        </div>
      </div>
    </div>
  );
}
