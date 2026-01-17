import type { ProviderProtocol } from "@/types";

export const LEMON_API_CONFIG = {
    id: "default-lemon-api", // LLM ID
    imageId: "default-lemon-api-image", // Image ID
    name: "Lemon AI",
    apiKey: "cat_768976896896464896",
    baseUrl: "https://geminibiz.lemon.vin",
    protocol: "openai" as ProviderProtocol,
};

// 本地代理路径（解决 Web 模式 CORS 问题）
export const PROXY_PATH = "/api_proxy_lemon";
