export type ProviderConfig = { baseUrl: string; model: string; apiKey: string };
export function providerUrl(base: string, suffix: string) {
  const url = new URL(base.replace(/\/$/, "") + "/" + suffix);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new Error("Provider URLs require HTTPS, except local providers.");
  return url;
}
export async function providerJson(response: Response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Provider returned HTTP ${response.status}. Check the configured endpoint, model, key, and account limits.`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Provider returned an empty body.");
  const parts: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.length;
    if (bytes > 4_000_000) {
      await reader.cancel();
      throw new Error("Provider response exceeds 4 MB.");
    }
    parts.push(next.value);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
  } catch {
    // Native parse errors can quote the provider body, including echoed secrets.
    throw new Error("Provider returned invalid JSON.");
  }
}
