import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Local evaluation evidence only. Never serialize providerOutput/reasoning. */
export function redactEvidence(
  value: unknown,
  secrets: string[] = [],
): unknown {
  if (typeof value === "string") {
    let text = value;
    for (const secret of secrets.filter(Boolean))
      text = text.split(secret).join("[REDACTED]");
    return text
      .replace(/Bearer\s+[^\s"\\]+/gi, "Bearer [REDACTED]")
      .replace(/data:[^\s"]+/g, "[MEDIA OMITTED]")
      .replace(/https?:\/\/[^\s"<>\\]+/g, (url) => {
        try {
          const u = new URL(url);
          u.username = "";
          u.password = "";
          u.search = "";
          u.hash = "";
          return u.href;
        } catch {
          return "[URL OMITTED]";
        }
      });
  }
  if (Array.isArray(value)) return value.map((v) => redactEvidence(v, secrets));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/(providerOutput|reasoning|encrypted|api.?key|authorization|password|secret|token)/i.test(
              key,
            ),
        )
        .map(([key, v]) => [key, redactEvidence(v, secrets)]),
    );
  return value;
}

export function createTrialEvidence(
  directory: string | undefined,
  secrets: string[] = [],
) {
  const events: unknown[] = [];
  let bytes = 0,
    omitted = 0;
  return {
    record(kind: string, payload: unknown) {
      if (!directory) return;
      const clean = redactEvidence(payload, secrets),
        encoded = JSON.stringify(clean);
      if (bytes + encoded.length > 8_000_000 || events.length >= 300) {
        omitted++;
        return;
      }
      bytes += encoded.length;
      events.push({ kind, payload: clean });
    },
    async save(trial: unknown) {
      if (!directory) return undefined;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = path.join(directory, `${randomUUID()}.json`);
      const data =
        JSON.stringify(
          {
            version: 1,
            trial: redactEvidence(trial, secrets),
            omitted,
            events,
          },
          null,
          2,
        ) + "\n";
      await writeFile(file, data, { flag: "wx", mode: 0o600 });
      return {
        path: file,
        sha256: createHash("sha256").update(data).digest("hex"),
        omitted,
      };
    },
    error(error: unknown) {
      return String(
        redactEvidence(
          error instanceof Error ? error.message : "Scenario failed",
          secrets,
        ),
      ).slice(0, 500);
    },
  };
}
