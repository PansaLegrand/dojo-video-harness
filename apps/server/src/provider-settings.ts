import { atomicReplace } from "./atomic-replace";
import { isGptModelId } from "../../../packages/adapters/src/gpt-model";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod/v3";
import {
  providerUrl,
  type ProviderConfig,
} from "../../../packages/adapters/src/provider-http";
import { HttpError } from "./store";
const configSchema = z
  .object({
    baseUrl: z.string().max(500),
    model: z.string().min(1).max(100),
    apiKey: z.string().max(8192),
  })
  .strict();
const savedSchema = z
  .object({
    version: z.literal(1),
    llm: configSchema.optional(),
    asr: configSchema.optional(),
    music: configSchema.optional(),
  })
  .strict();
const inputSchema = z
  .object({
    kind: z.enum(["llm", "asr", "music"]),
    baseUrl: z.string().trim().min(1).max(500),
    model: z.string().trim().min(1).max(100),
    apiKey: z.string().trim().max(8192).optional(),
    clearKey: z.boolean().optional(),
  })
  .strict();
type Kind = "llm" | "asr" | "music";
function validate(config: ProviderConfig, kind: Kind) {
  try {
    providerUrl(config.baseUrl, "models");
  } catch {
    throw new HttpError(
      "Use a provider base URL with HTTPS (or HTTP on localhost), without credentials, query parameters, or a fragment.",
    );
  }
  if (kind === "llm" && !isGptModelId(config.model))
    throw new HttpError(
      "Choose a GPT model such as gpt-6-sol or openai/gpt-6-sol.",
    );
  if (
    kind === "music" &&
    new URL(config.baseUrl).pathname.replace(/\/+$/, "") !== ""
  )
    throw new HttpError(
      "Use the music API origin, such as https://api.kie.ai, without /codex/v1.",
    );
  if (kind === "music" && config.model !== "V6")
    throw new HttpError(
      "The music adapter currently supports V6 instrumental generation.",
    );
  if (/[\r\n\u0000]/.test(config.apiKey))
    throw new HttpError("The provider key must be a single line.");
  return config;
}
/** Server-only credentials. Each job receives a copy so settings never switch a running job's provider. */
export class ProviderSettings {
  private saved: z.infer<typeof savedSchema> = { version: 1 };
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private directory: string,
    private defaults: Record<"llm" | "asr", ProviderConfig> &
      Partial<Record<"music", ProviderConfig>>,
  ) {}
  async load() {
    try {
      this.saved = savedSchema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new HttpError(
          "Local provider settings could not be read. Check provider-settings.json in your data directory.",
          500,
        );
    }
    for (const kind of ["llm", "asr", "music"] as const)
      validate(this.get(kind), kind);
  }
  private get file() {
    return path.join(this.directory, "provider-settings.json");
  }
  get(kind: Kind): ProviderConfig {
    return {
      ...(this.saved[kind] ??
        this.defaults[kind] ?? {
          baseUrl: "https://api.kie.ai",
          model: "V6",
          apiKey: "",
        }),
    };
  }
  public() {
    const show = (kind: Kind) => {
      const config = this.get(kind),
        local = ["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(config.baseUrl).hostname,
        );
      return {
        baseUrl: config.baseUrl,
        model: config.model,
        configured: !!config.apiKey || local,
        keyConfigured: !!config.apiKey,
        source: this.saved[kind] ? "settings" : "environment",
      };
    };
    return { llm: show("llm"), asr: show("asr"), music: show("music") };
  }
  save(raw: unknown) {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success)
      throw new HttpError(
        "Invalid provider settings. Check the URL, model, and key fields.",
      );
    const update = parsed.data;
    const operation = this.pending
      .catch(() => {})
      .then(async () => {
        const previous = this.get(update.kind);
        const baseUrl = update.baseUrl.replace(/\/+$/, "");
        if (update.clearKey && update.apiKey)
          throw new HttpError("Choose either a replacement key or Clear key.");
        if (
          baseUrl !== previous.baseUrl.replace(/\/+$/, "") &&
          previous.apiKey &&
          !update.apiKey &&
          !update.clearKey
        )
          throw new HttpError(
            "Enter a new key or clear the old key when changing provider URLs.",
          );
        const config = validate(
          {
            baseUrl,
            model: update.model,
            apiKey: update.clearKey ? "" : update.apiKey || previous.apiKey,
          },
          update.kind,
        );
        const next = { ...this.saved, [update.kind]: config };
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const temporary = this.file + "." + randomUUID() + ".tmp";
        await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", {
          mode: 0o600,
        });
        try {
          await atomicReplace(temporary, this.file);
        } finally {
          await rm(temporary, { force: true });
        }
        this.saved = next;
        return this.public();
      });
    this.pending = operation;
    return operation;
  }
}
