export type WorkspaceSaveFailureKind =
  | "offline"
  | "retryable"
  | "authentication"
  | "permission"
  | "validation"
  | "conflict";
export type WorkspaceSaveFailure = {
  kind: WorkspaceSaveFailureKind;
  message: string;
  status?: number;
  code?: string;
};

/** Only an explicit revision/edit conflict permits replacing operation identity. */
export function classifyWorkspaceSaveFailure(
  error: unknown,
  online = typeof navigator === "undefined" || navigator.onLine !== false,
): WorkspaceSaveFailure {
  const details =
    error && typeof error === "object"
      ? (error as { status?: unknown; code?: unknown })
      : {};
  const status =
    typeof details.status === "number" ? details.status : undefined;
  const code = typeof details.code === "string" ? details.code : undefined;
  const message =
    error instanceof Error
      ? error.message
      : "Changes could not be saved. Your pending edits are preserved.";
  const kind: WorkspaceSaveFailureKind =
    status === 409 && (code === "EDIT_CONFLICT" || code === "REVISION_CONFLICT")
      ? "conflict"
      : status === 401
        ? "authentication"
        : status === 403 || status === 404
          ? "permission"
          : status === 408 ||
              status === 425 ||
              status === 429 ||
              (status === 409 && code !== "IDEMPOTENCY_COLLISION") ||
              (status !== undefined && status >= 500)
            ? "retryable"
            : status !== undefined && status >= 400 && status < 500
              ? "validation"
              : !online
                ? "offline"
                : "retryable";
  return {
    kind,
    message,
    ...(status !== undefined ? { status } : {}),
    ...(code ? { code } : {}),
  };
}

export function workspaceSaveFailureAllowsRetry(
  failure: WorkspaceSaveFailure | null,
): boolean {
  return (
    !failure ||
    ["offline", "retryable", "authentication", "permission"].includes(
      failure.kind,
    )
  );
}
