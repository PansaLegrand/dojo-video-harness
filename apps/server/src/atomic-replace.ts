import { rename } from "node:fs/promises";
/** Windows readers/scanners can briefly lock a file against replacement. Retry only
 * the same atomic rename: never unlink the destination or replay the transaction. */
export async function atomicReplace(
  source: string,
  destination: string,
  options: {
    platform?: NodeJS.Platform;
    renameFile?: typeof rename;
    wait?: (ms: number) => Promise<void>;
  } = {},
) {
  const renameFile = options.renameFile ?? rename;
  const wait =
    options.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      await renameFile(source, destination);
      return;
    } catch (error) {
      const retryable =
        (options.platform ?? process.platform) === "win32" &&
        ["EACCES", "EPERM", "EBUSY"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        );
      if (!retryable || attempt >= 8) throw error;
      await wait(Math.min(10 * 2 ** attempt, 250));
    }
  }
}
