import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Pencil, Trash2, Save, Server, AlertTriangle } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { useModal, getModalAnimationClasses } from "@/hooks/useModal";
import type { Provider, NodeProviderMapping, ProviderProtocol } from "@/types";

// 协议类型配置
const protocolConfig: { key: ProviderProtocol; label: string }[] = [
  { key: "openai", label: "OpenAI" },
  { key: "google", label: "Google" },
  { key: "claude", label: "Claude" },
];

// 协议类型显示标签
const protocolLabels: Record<ProviderProtocol, string> = {
  openai: "OpenAI",
  google: "Google",
  claude: "Claude",
};

// 节点类型配置
const nodeTypeConfig: { key: keyof NodeProviderMapping; label: string; description: string }[] = [
  { key: "imageGeneratorPro", label: "NanoBanana Pro", description: "High Quality Image / PPT" },
  { key: "imageGeneratorFast", label: "NanoBanana", description: "Fast Image Generator" },
  { key: "videoGenerator", label: "Video Generator", description: "Sora Video Generator" },
  { key: "llmContent", label: "LLM Content", description: "Text Generation Node" },
  { key: "llm", label: "PPT Outline", description: "PPT Outline Generation" },
];

export function ProviderPanel() {
  const {
    settings,
    isProviderPanelOpen,
    closeProviderPanel,
    addProvider,
    updateProvider,
    removeProvider,
    setNodeProvider,
  } = useSettingsStore();

  // 本地状态：节点供应商映射
  const [localNodeProviders, setLocalNodeProviders] = useState<NodeProviderMapping>({});

  // 编辑/添加供应商的弹窗状态
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [isAddingProvider, setIsAddingProvider] = useState(false);
  // 删除确认状态
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  // 使用统一的 modal hook
  const { isVisible, isClosing, handleClose, handleBackdropClick } = useModal({
    isOpen: isProviderPanelOpen,
    onClose: closeProviderPanel,
  });

  // 获取动画类名
  const { backdropClasses, contentClasses } = getModalAnimationClasses(isVisible, isClosing);

  // 同步初始值
  useEffect(() => {
    if (isProviderPanelOpen) {
      setLocalNodeProviders(settings.nodeProviders || {});
    }
  }, [isProviderPanelOpen, settings.nodeProviders]);

  if (!isProviderPanelOpen) return null;

  // 确保 providers 数组存在
  const providers = settings.providers || [];

  // 保存节点配置
  const handleSave = () => {
    // 更新节点供应商映射
    for (const { key } of nodeTypeConfig) {
      setNodeProvider(key, localNodeProviders[key]);
    }
    closeProviderPanel();
  };

  // 删除供应商 - 显示确认弹窗
  const handleDeleteProvider = (provider: Provider) => {
    setDeleteConfirm({ id: provider.id, name: provider.name });
  };

  // 执行确认的删除操作
  const executeDelete = () => {
    if (!deleteConfirm) return;
    const { id } = deleteConfirm;
    setDeleteConfirm(null);

    removeProvider(id);
    // 同时清除本地状态中的映射
    const newLocalNodeProviders = { ...localNodeProviders };
    for (const key of Object.keys(newLocalNodeProviders) as (keyof NodeProviderMapping)[]) {
      if (newLocalNodeProviders[key] === id) {
        delete newLocalNodeProviders[key];
      }
    }
    setLocalNodeProviders(newLocalNodeProviders);
  };

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
          relative glass-panel rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col
          transition-all duration-200 ease-out border border-white/10
          ${contentClasses}
        `}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-outfit font-semibold text-white">Providers</h2>
          </div>
          <button
            className="glass-btn btn-square btn-sm rounded-full text-white/70 hover:text-white"
            onClick={handleClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容 - 可滚动 */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
          {/* 供应商列表区域 */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
              Provider List
            </h3>

            {/* 供应商卡片列表 */}
            {providers.length === 0 ? (
              <div className="text-center py-8 text-white/30 border border-dashed border-white/10 rounded-xl bg-white/5">
                <Server className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No providers configured</p>
                <p className="text-xs mt-1">Click below to add one</p>
              </div>
            ) : (
              <div className="space-y-2">
                {providers.map((provider) => (
                  <div
                    key={provider.id}
                    className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5 hover:bg-white/10 hover:border-white/10 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate text-white/90">{provider.name}</span>
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-white/10 text-white/60 shrink-0 border border-white/5">
                          {protocolLabels[provider.protocol] || "Google"}
                        </span>
                      </div>
                      <div className="text-xs text-white/40 truncate font-mono mt-0.5">
                        {provider.baseUrl}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        className="glass-btn btn-xs btn-square opacity-70 hover:opacity-100"
                        onClick={() => setEditingProvider(provider)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="glass-btn btn-xs btn-square text-error opacity-70 hover:opacity-100 hover:text-error hover:bg-error/10"
                        onClick={() => handleDeleteProvider(provider)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 添加供应商按钮 */}
            <button
              className="glass-btn btn-sm w-full gap-2 border-dashed border-white/20 hover:border-white/40 hover:bg-white/5"
              onClick={() => setIsAddingProvider(true)}
            >
              <Plus className="w-4 h-4" />
              Add Provider
            </button>
          </div>

          {/* 分隔线 */}
          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>

          {/* 节点配置区域 */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
              Node Configuration
            </h3>

            {providers.length === 0 ? (
              <div className="text-center py-4 text-white/30 text-xs italic">
                Please add a provider first
              </div>
            ) : (
              <div className="space-y-4">
                {nodeTypeConfig.map(({ key, label, description }) => (
                  <div key={key} className="form-control">
                    <label className="label py-1">
                      <span className="label-text font-medium text-white/80">{label}</span>
                    </label>
                    <Select
                      value={localNodeProviders[key] || ""}
                      placeholder="Not Configured"
                      options={[
                        { value: "", label: "Not Configured" },
                        ...providers.map((provider) => ({
                          value: provider.id,
                          label: `${provider.name} (${protocolLabels[provider.protocol] || "Google"})`,
                        })),
                      ]}
                      onChange={(value) =>
                        setLocalNodeProviders({
                          ...localNodeProviders,
                          [key]: value || undefined,
                        })
                      }
                    />
                    <label className="label py-0.5">
                      <span className="label-text-alt text-white/30 text-xs">
                        {description}
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/10 bg-black/20">
          <button className="glass-btn px-4" onClick={handleClose}>
            Cancel
          </button>
          <button className="btn btn-primary gap-2 shadow-lg shadow-primary/20" onClick={handleSave}>
            <Save className="w-4 h-4" />
            Save Configuration
          </button>
        </div>
      </div>

      {/* 添加/编辑供应商弹窗 */}
      {(isAddingProvider || editingProvider) && (
        <ProviderEditModal
          provider={editingProvider}
          onSave={(data) => {
            if (editingProvider) {
              updateProvider(editingProvider.id, data);
            } else {
              addProvider(data);
            }
            setEditingProvider(null);
            setIsAddingProvider(false);
          }}
          onClose={() => {
            setEditingProvider(null);
            setIsAddingProvider(false);
          }}
        />
      )}

      {/* 删除确认弹窗 */}
      {deleteConfirm && (
        <DeleteConfirmModal
          name={deleteConfirm.name}
          onConfirm={executeDelete}
          onClose={() => setDeleteConfirm(null)}
        />
      )}
    </div>,
    document.body
  );
}

// 供应商编辑弹窗组件
interface ProviderEditModalProps {
  provider: Provider | null;
  onSave: (data: Omit<Provider, "id">) => void;
  onClose: () => void;
}

function ProviderEditModal({ provider, onSave, onClose }: ProviderEditModalProps) {
  const [name, setName] = useState(provider?.name || "");
  const [apiKey, setApiKey] = useState(provider?.apiKey || "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl || "");
  const [protocol, setProtocol] = useState<ProviderProtocol>(provider?.protocol || "google");

  // 使用统一的 modal hook
  const { isVisible, isClosing, handleClose, handleBackdropClick } = useModal({
    isOpen: true,
    onClose,
  });

  // 获取动画类名
  const { backdropClasses, contentClasses } = getModalAnimationClasses(isVisible, isClosing);

  const isEditing = !!provider;
  const canSave = name.trim() && apiKey.trim() && baseUrl.trim();

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      protocol,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className={`
          absolute inset-0 bg-black/50 backdrop-blur-sm
          transition-all duration-200 ease-out
          ${backdropClasses}
        `}
        onClick={handleBackdropClick}
      />
      {/* Modal 内容 */}
      <div
        className={`
          relative glass-panel rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden border border-white/10
          transition-all duration-200 ease-out
          ${contentClasses}
        `}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-white/5">
          <h3 className="font-semibold text-white">
            {isEditing ? "Edit Provider" : "Add Provider"}
          </h3>
          <button
            className="glass-btn btn-xs btn-square rounded-full text-white/50 hover:text-white"
            onClick={handleClose}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 协议类型选择 Tab */}
        <div className="px-5 pt-4">
          <div className="flex bg-black/20 rounded-lg p-1 border border-white/5">
            {protocolConfig.map(({ key, label }) => (
              <button
                key={key}
                className={`
                  flex-1 py-1.5 px-3 text-sm font-medium rounded-md transition-all
                  ${protocol === key
                    ? "bg-white/10 text-white shadow-sm ring-1 ring-white/5"
                    : "text-white/40 hover:text-white/70 hover:bg-white/5"
                  }
                `}
                onClick={() => setProtocol(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 表单 */}
        <div className="p-5 space-y-4">
          {/* 名称 */}
          <div className="form-control">
            <label className="label py-1">
              <span className="label-text font-medium text-white/80">Name</span>
            </label>
            <Input
              placeholder="e.g. My API Service"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              className="bg-black/20 border-white/10 text-white placeholder:text-white/20 focus:border-primary/50"
            />
          </div>

          {/* API Key */}
          <div className="form-control">
            <label className="label py-1">
              <span className="label-text font-medium text-white/80">API Key</span>
            </label>
            <Input
              isPassword
              placeholder="Enter API Key"
              value={apiKey}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
              className="bg-black/20 border-white/10 text-white placeholder:text-white/20 focus:border-primary/50"
            />
          </div>

          {/* Base URL */}
          <div className="form-control">
            <label className="label py-1">
              <span className="label-text font-medium text-white/80">Base URL</span>
            </label>
            <Input
              placeholder="e.g. https://api.example.com"
              value={baseUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBaseUrl(e.target.value)}
              className="bg-black/20 border-white/10 text-white placeholder:text-white/20 focus:border-primary/50"
            />
            <label className="label py-0.5">
              <span className="label-text-alt text-white/30 text-xs">
                No version suffix (e.g. /v1beta) required
              </span>
            </label>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/10 bg-black/20">
          <button className="glass-btn btn-sm" onClick={handleClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={!canSave}
          >
            {isEditing ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 删除确认弹窗组件
interface DeleteConfirmModalProps {
  name: string;
  onConfirm: () => void;
  onClose: () => void;
}

function DeleteConfirmModal({ name, onConfirm, onClose }: DeleteConfirmModalProps) {
  // 使用统一的 modal hook
  const { isVisible, isClosing, handleClose, handleBackdropClick } = useModal({
    isOpen: true,
    onClose,
  });

  // 获取动画类名
  const { backdropClasses, contentClasses } = getModalAnimationClasses(isVisible, isClosing);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className={`
          absolute inset-0 bg-black/60 backdrop-blur-sm
          transition-all duration-200 ease-out
          ${backdropClasses}
        `}
        onClick={handleBackdropClick}
      />
      {/* Modal 内容 */}
      <div
        className={`
          relative glass-panel rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5 border border-error/20
          transition-all duration-200 ease-out
          ${contentClasses}
        `}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-error/20 rounded-lg text-error">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-white">Delete Provider?</h3>
        </div>
        <p className="text-sm text-white/70 mb-5 leading-relaxed">
          Are you sure you want to delete <span className="text-white font-medium">"{name}"</span>?
          <br />
          This will also remove any node configurations using this provider. This cannot be undone.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            className="glass-btn btn-sm"
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            className="btn btn-error btn-sm"
            onClick={onConfirm}
          >
            Confirm Delete
          </button>
        </div>
      </div>
    </div>
  );
}
