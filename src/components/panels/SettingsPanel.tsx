
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Save,
  RotateCcw,
  Server,
  HardDrive,
  Keyboard,

  ExternalLink,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Info,
  AlertTriangle,
  Settings,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSettingsStore, type SettingsTab } from "@/stores/settingsStore";
import { Select } from "@/components/ui/Select";
import { useModal, getModalAnimationClasses } from "@/hooks/useModal";
import type { AppSettings } from "@/types";
import {
  checkForUpdates,
  getCurrentVersion,

  PROJECT_INFO,
  type UpdateInfo,
} from "@/services/updateService";
import { ProviderPanelContent } from "@/components/panels/ProviderPanel";
import { StorageManagementContent } from "@/components/ui/StorageManagementModal";
import { KeyboardShortcutsContent } from "@/components/panels/KeyboardShortcutsPanel";

// 更新按钮状态类型
type UpdateButtonState = "idle" | "checking" | "latest" | "hasUpdate" | "error";

export function SettingsPanel() {
  const {
    settings,
    isSettingsOpen,
    closeSettings,
    updateSettings,
    resetSettings,
    settingsTab,
    openSettings,
  } = useSettingsStore();

  const activeTab = settingsTab;
  const setActiveTab = openSettings;

  const [localTheme, setLocalTheme] = useState<AppSettings["theme"]>(
    settings.theme
  );
  const [updateButtonState, setUpdateButtonState] =
    useState<UpdateButtonState>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  // 重置确认对话框
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // 使用统一的 modal hook
  const { isVisible, isClosing, handleClose, handleBackdropClick } = useModal({
    isOpen: isSettingsOpen,
    onClose: closeSettings,
  });

  // 获取动画类名
  const { backdropClasses, contentClasses } = getModalAnimationClasses(isVisible, isClosing);

  // Effect to handle opening specific tabs based on initial props or store state if complex logic existed
  // For now simple tab state.

  // If user opens "Help" from sidebar shortcut, store might call it.
  // Actually Help functionality in store sets `isHelpOpen`.
  // We need to sync that status? 
  // Step 58 added `isHelpOpen` to settings store.
  // We should listen to it or deprecate `isHelpOpen` in favor of just opening settings with tab.
  // Let's assume for now clicking "Settings" opens general tab.

  // Update local theme state when settings change
  useEffect(() => {
    setLocalTheme(settings.theme);
  }, [settings.theme]);

  if (!isSettingsOpen) return null;

  const handleSave = () => {
    updateSettings({ theme: localTheme });
    closeSettings();
  };

  const handleReset = () => {
    resetSettings();
    setLocalTheme(useSettingsStore.getState().settings.theme);
    setShowResetConfirm(false);
  };

  const handleCheckUpdate = async () => {
    setUpdateButtonState("checking");
    setUpdateInfo(null);

    try {
      const info = await checkForUpdates();
      setUpdateInfo(info);
      setUpdateButtonState(info.hasUpdate ? "hasUpdate" : "latest");

      if (!info.hasUpdate) {
        setTimeout(() => {
          setUpdateButtonState("idle");
        }, 3000);
      }
    } catch {
      setUpdateButtonState("error");
      setTimeout(() => {
        setUpdateButtonState("idle");
      }, 3000);
    }
  };



  const handleOpenRelease = async () => {
    if (updateInfo?.releaseUrl) {
      await openUrl(updateInfo.releaseUrl);
    }
  };

  // Nav Item helper
  const NavItem = ({ id, icon: Icon, label }: { id: SettingsTab; icon: React.ElementType; label: string }) => (
    <button
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm font-medium
        ${activeTab === id
          ? "bg-primary text-primary-content shadow-sm"
          : "hover:bg-base-200 text-base-content/70 hover:text-base-content"
        }
      `}
      onClick={() => setActiveTab(id)}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );

  const getUpdateButtonProps = () => {
    switch (updateButtonState) {
      case "checking":
        return {
          className: "btn btn-outline w-full gap-2",
          disabled: true,
          icon: <RefreshCw className="w-4 h-4 animate-spin" />,
          text: "正在检测...",
        };
      case "latest":
        return {
          className: "btn btn-success w-full gap-2",
          disabled: false,
          icon: <CheckCircle className="w-4 h-4" />,
          text: "已是最新版本",
        };
      case "error":
        return {
          className: "btn btn-error btn-outline w-full gap-2",
          disabled: false,
          icon: <AlertCircle className="w-4 h-4" />,
          text: "检测失败",
        };
      default:
        return {
          className: "btn btn-outline w-full gap-2",
          disabled: false,
          icon: <RefreshCw className="w-4 h-4" />,
          text: "检测更新",
        };
    }
  };

  const updateButtonProps = getUpdateButtonProps();

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className={`
          absolute inset-0
          transition-all duration-200 ease-out
          ${backdropClasses}
        `}
        onClick={handleBackdropClick}
      />
      {/* Modal 内容 - Max size increased for 2-column layout */}
      <div
        className={`
          relative bg-base-100 rounded-2xl shadow-2xl w-[900px] h-[600px] overflow-hidden flex
          transition-all duration-200 ease-out
          ${contentClasses}
        `}
      >
        {/* Left Sidebar Navigation */}
        <div className="w-64 bg-base-200/50 border-r border-base-300 flex flex-col p-4">
          <h2 className="text-lg font-bold px-2 mb-6 flex items-center gap-2">
            <Settings className="w-5 h-5" />
            设置
          </h2>

          <div className="space-y-1">
            <NavItem id="general" icon={Settings} label="通用设置" />
            {settings.enableCustomProviders && (
              <NavItem id="providers" icon={Server} label="供应商管理" />
            )}
            <NavItem id="storage" icon={HardDrive} label="存储管理" />
            <NavItem id="shortcuts" icon={Keyboard} label="快捷键" />
            <NavItem id="about" icon={Info} label="关于" />
          </div>

          <div className="mt-auto pt-4 border-t border-base-300">
            <div className="flex items-center gap-2 px-2 text-xs text-base-content/50">
              <span>版本 v{getCurrentVersion()}</span>
            </div>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-base-100 relative">
          <button
            className="absolute top-4 right-4 btn btn-ghost btn-sm btn-circle z-10"
            onClick={handleClose}
          >
            <X className="w-5 h-5" />
          </button>

          {/* Content Switcher */}
          <div className="flex-1 overflow-hidden relative">

            {/* General Settings */}
            {activeTab === "general" && (
              <div className="h-full overflow-y-auto p-8">
                <h3 className="text-xl font-bold mb-6">通用设置</h3>

                <div className="space-y-6 max-w-lg">
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">界面主题</span>
                    </label>
                    <Select
                      value={localTheme}
                      options={[
                        { value: "light", label: "浅色模式" },
                        { value: "dark", label: "深色模式" },
                        { value: "system", label: "跟随系统" },
                      ]}
                      onChange={(value) =>
                        setLocalTheme(value as AppSettings["theme"])
                      }
                    />
                    <label className="label">
                      <span className="label-text-alt text-base-content/50">
                        选择您喜欢的界面外观风格
                      </span>
                    </label>
                  </div>

                  <div className="form-control">
                    <label className="label cursor-pointer justify-start gap-4">
                      <span className="label-text font-medium">显示供应商管理</span>
                      <input
                        type="checkbox"
                        className="toggle toggle-primary"
                        checked={settings.enableCustomProviders}
                        onChange={(e) =>
                          updateSettings({ enableCustomProviders: e.target.checked })
                        }
                      />
                    </label>
                    <label className="label">
                      <span className="label-text-alt text-base-content/50">
                        开启后可配置自定义模型供应商，关闭时使用系统默认服务
                      </span>
                    </label>
                  </div>

                  <div className="divider"></div>

                  <div className="flex justify-start gap-3">
                    <button className="btn btn-primary" onClick={handleSave}>
                      <Save className="w-4 h-4" />
                      保存设置
                    </button>
                    <button
                      className="btn btn-ghost text-error"
                      onClick={() => setShowResetConfirm(true)}
                    >
                      <RotateCcw className="w-4 h-4" />
                      重置所有设置
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Providers */}
            {activeTab === "providers" && <ProviderPanelContent />}

            {/* Storage */}
            {activeTab === "storage" && <StorageManagementContent />}

            {/* Shortcuts */}
            {activeTab === "shortcuts" && <KeyboardShortcutsContent />}

            {/* About */}
            {activeTab === "about" && (
              <div className="h-full overflow-y-auto p-8">
                <h3 className="text-xl font-bold mb-6">关于 NextLemon</h3>

                <div className="space-y-6 max-w-lg">
                  {/* 项目信息卡片 */}
                  <div className="bg-base-200 rounded-xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-2xl">
                          {PROJECT_INFO.name}
                        </span>
                        <span className="badge badge-primary badge-lg">
                          v{getCurrentVersion()}
                        </span>
                      </div>
                    </div>

                    <p className="text-base text-base-content/70 leading-relaxed">
                      {PROJECT_INFO.description}
                    </p>

                    <div className="flex items-center gap-6 text-sm text-base-content/50 pt-2 border-t border-base-content/10">
                      <span>作者: {PROJECT_INFO.author}</span>
                      <span>许可证: {PROJECT_INFO.license}</span>
                    </div>
                  </div>



                  {/* 检测更新按钮 */}
                  <button
                    className={updateButtonProps.className}
                    onClick={handleCheckUpdate}
                    disabled={updateButtonProps.disabled}
                  >
                    {updateButtonProps.icon}
                    {updateButtonProps.text}
                  </button>

                  {/* 有新版本时显示更新信息 */}
                  {updateButtonState === "hasUpdate" && updateInfo && (
                    <div className="p-4 rounded-xl bg-warning/10 border border-warning/20">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-5 h-5 text-warning" />
                          <span className="font-medium text-warning">发现新版本</span>
                        </div>
                        <div className="text-sm space-y-1">
                          <div className="flex justify-between">
                            <span className="text-base-content/70">当前版本:</span>
                            <span>v{updateInfo.currentVersion}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-base-content/70">最新版本:</span>
                            <span className="text-warning font-medium">
                              v{updateInfo.latestVersion}
                            </span>
                          </div>
                          {updateInfo.publishedAt && (
                            <div className="flex justify-between">
                              <span className="text-base-content/70">发布时间:</span>
                              <span>
                                {new Date(updateInfo.publishedAt).toLocaleDateString(
                                  "zh-CN"
                                )}
                              </span>
                            </div>
                          )}
                        </div>
                        <button
                          className="btn btn-warning btn-sm w-full gap-2"
                          onClick={handleOpenRelease}
                        >
                          <ExternalLink className="w-4 h-4" />
                          前往下载
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 重置确认对话框 */}
        {showResetConfirm && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50 rounded-2xl">
            <div className="bg-base-100 rounded-xl p-5 mx-4 max-w-sm shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-error/10 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-error" />
                </div>
                <h3 className="font-semibold">确认重置</h3>
              </div>
              <p className="text-sm text-base-content/70 mb-5">
                确定要重置所有设置吗？这将清除所有供应商配置和节点分配，此操作不可撤销。
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowResetConfirm(false)}
                >
                  取消
                </button>
                <button className="btn btn-error btn-sm" onClick={handleReset}>
                  确认重置
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
