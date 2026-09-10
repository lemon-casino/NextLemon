import { useEffect } from "react";
import { installLocalAgentBridge } from "@/services/localAgentBridge";
import { useLocalAgentBridgeStore } from "@/stores/localAgentBridgeStore";

export function LocalAgentBridgeRuntime() {
  const enabled = useLocalAgentBridgeStore((state) => state.enabled);

  useEffect(() => {
    if (!enabled) return undefined;
    return installLocalAgentBridge();
  }, [enabled]);

  return null;
}
