import { useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Save,
  RotateCcw,
  Server,
  Github,
  ExternalLink,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Info,
  AlertTriangle,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSettingsStore } from "@/stores/settingsStore";
import { Select } from "@/components/ui/Select";
import { useModal, getModalAnimationClasses } from "@/hooks/useModal";
import type { AppSettings } from "@/types";
import {
  checkForUpdates,
  getCurrentVersion,
  GITHUB_REPO,
  PROJECT_INFO,
  type UpdateInfo,
} from "@/services/updateService";

// 更新按钮状态类型
// 更新按钮状态类型
type UpdateButtonState = "idle" | "checking" | "latest" | "hasUpdate" | "error";

export function SettingsPanel() {
  const {
    settings,
    isSettingsOpen,
    closeSettings,
    updateSettings,
    resetSettings,
    openProviderPanel,
  } = useSettingsStore();
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

  const handleOpenProviders = () => {
    closeSettings();
    openProviderPanel();
  };

  const handleCheckUpdate = async () => {
    setUpdateButtonState("checking");
    setUpdateInfo(null);

    try {
      const info = await checkForUpdates();
      setUpdateInfo(info);
      setUpdateButtonState(info.hasUpdate ? "hasUpdate" : "latest");

      // 如果已是最新版本，3秒后恢复按钮状态
      if (!info.hasUpdate) {
        setTimeout(() => {
          setUpdateButtonState("idle");
        }, 3000);
      }
    } catch {
      setUpdateButtonState("error");
      // 错误状态 3 秒后恢复
      setTimeout(() => {
        setUpdateButtonState("idle");
      }, 3000);
    }
  };

  const handleOpenGitHub = async () => {
    await openUrl(GITHUB_REPO.url);
  };

  const handleOpenRelease = async () => {
    if (updateInfo?.releaseUrl) {
      await openUrl(updateInfo.releaseUrl);
    }
  };

  // 获取更新按钮的样式和内容
  const getUpdateButtonProps = () => {
    switch (updateButtonState) {
      case "checking":
        return {
          className: "glass-btn w-full gap-2 opacity-70",
          disabled: true,
          icon: <RefreshCw className="w-4 h-4 animate-spin" />,
          text: "Checking...",
        };
      case "latest":
        return {
          className: "glass-btn text-success w-full gap-2",
          disabled: false,
          icon: <CheckCircle className="w-4 h-4" />,
          text: "Latest Version",
        };
      case "error":
        return {
          className: "glass-btn text-error w-full gap-2",
          disabled: false,
          icon: <AlertCircle className="w-4 h-4" />,
          text: "Check Failed",
        };
      default:
        return {
          className: "glass-btn w-full gap-2",
          disabled: false,
          icon: <RefreshCw className="w-4 h-4" />,
          text: "Check Update",
        };
    }
  };

  const updateButtonProps = getUpdateButtonProps();

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className={`
          absolute inset-0 bg-black/40 backdrop-blur-sm
          transition-all duration-200 ease-out
          ${backdropClasses}
        `}
        onClick={handleBackdropClick}
      />
      {/* Modal 内容 */}
      <div
        className={`
          relative glass-panel rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden max-h-[90vh] flex flex-col
          transition-all duration-200 ease-out border border-white/10
          ${contentClasses}
        `}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-outfit font-semibold text-white">Settings</h2>
          <button
            className="glass-btn btn-square btn-sm rounded-full text-white/70 hover:text-white"
            onClick={handleClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
          {/* 供应商管理入口 */}
          <div
            className="flex items-center justify-between p-4 bg-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors border border-white/5 hover:border-white/10"
            onClick={handleOpenProviders}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center text-primary border border-primary/20">
                <Server className="w-5 h-5" />
              </div>
              <div className="text-left">
                <div className="font-medium text-white">Provider Management</div>
                <div className="text-xs text-white/50">
                  Configure API providers & models
                </div>
              </div>
            </div>
            <div className="text-white/30">→</div>
          </div>

          {/* 分隔线 */}
          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>

          {/* 主题 */}
          <div className="form-control">
            <label className="label pt-0">
              <span className="label-text font-medium text-white/80">Theme</span>
            </label>
            <Select
              value={localTheme}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
              onChange={(value) =>
                setLocalTheme(value as AppSettings["theme"])
              }
            />
          </div>

          {/* 分隔线 */}
          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>

          {/* 关于与更新 */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-white/50" />
              <span className="font-medium text-white/80 text-sm">About</span>
            </div>

            {/* 项目信息卡片 */}
            <div className="bg-gradient-to-br from-white/5 to-white/0 rounded-xl p-4 space-y-3 border border-white/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-lg font-outfit text-white">
                    {PROJECT_INFO.name}
                  </span>
                  <span className="badge badge-primary badge-sm border-0 bg-primary/20 text-primary font-medium">
                    v{getCurrentVersion()}
                  </span>
                </div>
              </div>

              <p className="text-xs text-white/60">
                {PROJECT_INFO.description}
              </p>

              <div className="flex items-center gap-4 text-[10px] text-white/40 uppercase tracking-wider">
                <span>By {PROJECT_INFO.author}</span>
                <span>{PROJECT_INFO.license} License</span>
              </div>
            </div>

            {/* GitHub 仓库链接 */}
            <div
              className="flex items-center justify-between p-3 bg-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors group border border-white/5 hover:border-white/10"
              onClick={handleOpenGitHub}
            >
              <div className="flex items-center gap-3">
                <Github className="w-5 h-5 text-white/80 group-hover:text-white" />
                <div className="text-left">
                  <div className="text-sm font-medium text-white/80 group-hover:text-white">GitHub Repository</div>
                  <div className="text-xs text-white/40">
                    {GITHUB_REPO.owner}/{GITHUB_REPO.repo}
                  </div>
                </div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-white/30 group-hover:text-white/50" />
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
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-500" />
                    <span className="font-medium text-amber-500">New Version Available</span>
                  </div>
                  <div className="text-xs space-y-1 text-white/70">
                    <div className="flex justify-between">
                      <span className="text-white/40">Current:</span>
                      <span className="font-mono">v{updateInfo.currentVersion}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/40">Latest:</span>
                      <span className="text-amber-500 font-mono font-medium">
                        v{updateInfo.latestVersion}
                      </span>
                    </div>
                    {updateInfo.publishedAt && (
                      <div className="flex justify-between">
                        <span className="text-white/40">Released:</span>
                        <span>
                          {new Date(updateInfo.publishedAt).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-warning btn-sm w-full gap-2 border-none bg-amber-500 text-black hover:bg-amber-400"
                    onClick={handleOpenRelease}
                  >
                    <ExternalLink className="w-4 h-4" />
                    Download
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-black/20">
          <button
            className="text-error/70 hover:text-error text-sm flex items-center gap-2 hover:bg-error/10 px-3 py-2 rounded-lg transition-colors"
            onClick={() => setShowResetConfirm(true)}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
          <div className="flex gap-2">
            <button className="glass-btn px-4" onClick={handleClose}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm gap-2" onClick={handleSave}>
              <Save className="w-4 h-4" />
              Save
            </button>
          </div>
        </div>

        {/* 重置确认对话框 */}
        {showResetConfirm && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-10 p-6">
            <div className="glass-panel border border-error/30 rounded-xl p-5 w-full shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-error/20 text-error rounded-lg">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-white">Reset Settings?</h3>
              </div>
              <p className="text-sm text-white/70 mb-6 leading-relaxed">
                This will clear all provider configurations and custom settings. This action cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  className="glass-btn btn-sm"
                  onClick={() => setShowResetConfirm(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-error btn-sm" onClick={handleReset}>
                  Confirm Reset
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
