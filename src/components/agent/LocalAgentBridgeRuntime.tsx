import { useEffect, useSyncExternalStore } from "react";
import { installLocalAgentBridge } from "@/services/localAgentBridge";
import {
  getRealtimeBridgeStatusSnapshot,
  startRealtimeBridge,
  subscribeRealtimeBridgeStatus,
} from "@/services/agentRealtimeBridge";
import { useLocalAgentBridgeStore } from "@/stores/localAgentBridgeStore";

export function LocalAgentBridgeRuntime() {
  const enabled = useLocalAgentBridgeStore((state) => state.enabled);
  // 实时桥配置变更（端口/token/开关）时触发按新配置重连。
  const realtimeStatus = useSyncExternalStore(subscribeRealtimeBridgeStatus, getRealtimeBridgeStatusSnapshot);
  const realtimeConfigVersion = realtimeStatus.configVersion;

  useEffect(() => {
    if (!enabled) return undefined;
    const uninstall = installLocalAgentBridge();
    const stopRealtime = startRealtimeBridge();
    return () => {
      stopRealtime();
      uninstall();
    };
  }, [enabled, realtimeConfigVersion]);

  return null;
}
