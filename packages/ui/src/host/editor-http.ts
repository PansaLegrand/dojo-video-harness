/** Stable local-job identities are a host concern, not a product UI fork. */
export async function editorRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  let key: string | undefined;
  if (
    init?.method === "POST" &&
    typeof init.body === "string" &&
    [
      "/api/asr/tasks/create-and-start-automatic-speech-recognition",
      "/api/subtitle-translation",
    ].includes(url)
  ) {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(url + ":" + JSON.stringify(body)),
    );
    key =
      "dojo-harness:provider-request:" +
      [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    const operation = localStorage.getItem(key) ?? crypto.randomUUID();
    localStorage.setItem(key, operation);
    init = {
      ...init,
      body: JSON.stringify({ ...body, request_id: operation }),
    };
  }
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    if (key && [400, 401, 403, 404, 413, 422].includes(response.status))
      localStorage.removeItem(key);
    throw Object.assign(
      new Error(
        body?.message ?? body?.error ?? `Request failed (${response.status})`,
      ),
      { status: response.status },
    );
  }
  if (key) localStorage.removeItem(key);
  return body.data as T;
}
