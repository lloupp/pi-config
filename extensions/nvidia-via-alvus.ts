import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Provider "nvidia" servido pelo Alvus (proxy local em 127.0.0.1:3000 com pool
// de chaves NVIDIA NIM + retry silencioso em 429). O Alvus injeta a chave real
// do pool, entao apiKey aqui e um placeholder. reasoning_effort (thinkingFormat
// "openai") e traduzido pelo Alvus (Patch C) em thinking do template NIM.
// contextWindow/maxTokens refletem os limites reais de cada modelo (fonte:
// models_dev_cache do Hermes) para o indicador de contexto do Pi ser correto.
export default function (pi: ExtensionAPI) {
  pi.registerProvider("nvidia", {
    name: "NVIDIA (via Alvus)",
    baseUrl: "http://127.0.0.1:3000/v1",
    apiKey: "nvapi-alvus-pool",
    api: "openai-completions",
    models: [
      {
        id: "z-ai/glm-5.2",
        name: "GLM-5.2 (NVIDIA)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000000,
        maxTokens: 32768,
        compat: { supportsReasoningEffort: true, thinkingFormat: "openai" },
      },
      {
        id: "deepseek-ai/deepseek-v4-flash",
        name: "DeepSeek V4 Flash (NVIDIA)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000000,
        maxTokens: 32768,
        compat: { supportsReasoningEffort: true, thinkingFormat: "openai" },
      },
      {
        id: "qwen/qwen3-next-80b-a3b-instruct",
        name: "Qwen3-Next 80B Instruct (NVIDIA)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 256000,
        maxTokens: 32768,
        compat: { supportsReasoningEffort: false },
      },
    ],
  });
}
