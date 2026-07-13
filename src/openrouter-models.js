import { readFile } from "node:fs/promises";

const gameRoot = new URL("../", import.meta.url);
const envUrl = new URL(".env", gameRoot);
const configUrl = new URL("openrouter-models.config.json", gameRoot);

export async function getOpenRouterApiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    const env = parseEnv(await readFile(envUrl, "utf8"));
    return env.OPENROUTER_API_KEY || "";
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

export async function getModelCatalog() {
  const config = JSON.parse(await readFile(configUrl, "utf8"));
  const freeModels = normalizeModels(config.freeModels, "free");
  const paidModels = normalizeModels(config.paidModels || [], "paid");
  const models = [...freeModels, ...paidModels];
  if (!freeModels.length) throw new Error("At least one free OpenRouter model must be configured.");
  const defaultModel = models.some((model) => model.id === config.defaultModel)
    ? config.defaultModel
    : freeModels[0].id;
  return {
    models,
    defaultModel,
    freeModels: freeModels.map((model) => model.id),
    paidModels: paidModels.map((model) => model.id),
    source: "game-config"
  };
}

export function selectModel(catalog, requestedModel) {
  const selected = typeof requestedModel === "string" && requestedModel.trim()
    ? requestedModel.trim()
    : catalog.defaultModel;
  if (!catalog.models.some((model) => model.id === selected)) {
    throw Object.assign(new Error("The selected model is not in the server model catalog."), { status: 400 });
  }
  return selected;
}

function normalizeModels(values, tier) {
  if (!Array.isArray(values)) throw new Error(`${tier}Models must be an array.`);
  return values.map((entry) => {
    const model = typeof entry === "string" ? { id: entry, name: entry } : entry;
    const id = String(model?.id || "").trim();
    if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:+-]*$/i.test(id)) throw new Error(`Invalid ${tier} model identifier.`);
    if (tier === "free" && !id.endsWith(":free")) throw new Error("Free model identifiers must end with :free.");
    if (tier === "paid" && id.endsWith(":free")) throw new Error("Paid model identifiers must not end with :free.");
    return { id, name: String(model.name || id), tier };
  });
}

function parseEnv(source) {
  return Object.fromEntries(String(source)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const splitAt = line.indexOf("=");
      return [line.slice(0, splitAt).trim(), line.slice(splitAt + 1).trim().replace(/^(['"])(.*)\1$/, "$2")];
    }));
}
