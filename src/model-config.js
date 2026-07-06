export const openRouterConfig = {
  provider: "openrouter",
  endpoint: "https://openrouter.ai/api/v1/chat/completions",
  publicModelSource: "https://openrouter.ai/api/v1/models",
  freeModels: {
    colluder: "cohere/north-mini-code:free",
    monitor: "nvidia/nemotron-3-ultra-550b-a55b:free"
  },
  timeoutMs: 12000
};
