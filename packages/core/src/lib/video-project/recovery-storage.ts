import type { VideoProjectSnapshot } from "./types";
import type { WorkspacePendingOperation } from "./client-controller";
import { RecoveryJournalCodec, type RecoveryJournal } from "./recovery-journal";

export type WorkspaceRecoveryStore = {
  load(): Promise<unknown | null>;
  save(record: RecoveryJournal | null): Promise<void>;
  backup(
    reason: "conflict" | "rejected",
    record: RecoveryJournal,
  ): Promise<void>;
  close?(): void;
  reopen?(): void;
};
export class RecoveryWriteConflict extends Error {
  constructor() {
    super(
      "Another tab changed this project's recovery data. Keep this tab open until its pending changes are saved.",
    );
    this.name = "RecoveryWriteConflict";
  }
}
export const RECOVERY_STORAGE_WARNING =
  "Browser recovery is unavailable. Keep this tab open until pending changes are saved.";
const DATABASE = "dojoclip-video-recovery";
/** Explicitly discarded/replaced drafts: retain the newest two per project and reason.
 * Live journals and server undo history are never part of this retention policy. */
export const RECOVERY_BACKUPS_PER_REASON = 2;
type BackupRow = {
  id: string;
  projectId: string;
  reason: "conflict" | "rejected";
  createdAt: number;
  order?: number;
  record: RecoveryJournal | null;
};
type Row = { token: string; record: RecoveryJournal | null };
type LegacyStorage = Pick<Storage, "getItem" | "removeItem">;

/** Atomic token checks prevent one tab's late save/delete from erasing another tab's draft. */
export class IndexedDBWorkspaceRecoveryStore implements WorkspaceRecoveryStore {
  private connection: Promise<IDBDatabase> | null = null;
  private token: string | null | undefined;
  private legacyValue: string | null = null;
  private operations: Promise<unknown> = Promise.resolve();
  private closing = false;
  private lifecycle = 0;
  private readonly legacyKey: string;
  constructor(
    private readonly projectId: string,
    private readonly legacy?: LegacyStorage,
    private readonly factory: IDBFactory | undefined = globalThis.indexedDB,
  ) {
    this.legacyKey = `dojoclip-video-commands:${projectId}`;
  }
  private database() {
    if (!this.factory)
      return Promise.reject(new Error(RECOVERY_STORAGE_WARNING));
    if (this.connection) return this.connection;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let failed = false;
      const request = this.factory!.open(DATABASE, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("journals"))
          db.createObjectStore("journals");
        const backups = db.objectStoreNames.contains("backups")
          ? request.transaction!.objectStore("backups")
          : db.createObjectStore("backups", { keyPath: "id" });
        if (!backups.indexNames.contains("projectReason"))
          backups.createIndex("projectReason", ["projectId", "reason"]);
      };
      request.onsuccess = () => {
        const db = request.result;
        if (failed) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          this.connection = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        failed = true;
        reject(request.error ?? new Error(RECOVERY_STORAGE_WARNING));
      };
      request.onblocked = () => {
        failed = true;
        reject(
          new Error(
            "Close another editor tab to open browser recovery storage.",
          ),
        );
      };
    });
    const connection: Promise<IDBDatabase> = opening.catch((cause) => {
      // Includes synchronous factory.open failures as well as request events.
      if (this.connection === connection) this.connection = null;
      throw cause;
    });
    this.connection = connection;
    return connection;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing)
      return Promise.reject(new Error("Browser recovery storage is closed."));
    const next = this.operations.catch(() => undefined).then(operation);
    this.operations = next;
    return next;
  }
  load() {
    return this.serial(async () => {
      try {
        this.legacyValue = this.legacy?.getItem(this.legacyKey) ?? null;
      } catch {
        this.legacyValue = null;
      }
      let db: IDBDatabase;
      try {
        db = await this.database();
      } catch (error) {
        if (this.legacyValue) return JSON.parse(this.legacyValue);
        throw error;
      }
      const row = await new Promise<Row | undefined>((resolve, reject) => {
        const tx = db.transaction("journals", "readonly"),
          request = tx.objectStore("journals").get(this.projectId);
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = tx.onerror;
      });
      this.token = row?.token ?? null;
      if (row?.record) {
        this.legacyValue = null;
        return row.record;
      }
      return this.legacyValue ? JSON.parse(this.legacyValue) : null;
    });
  }
  private async mutate(
    record: RecoveryJournal | null,
    backup?: "conflict" | "rejected",
  ) {
    const db = await this.database();
    const nextToken = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        backup ? ["journals", "backups"] : ["journals"],
        "readwrite",
      );
      const store = tx.objectStore("journals"),
        request = store.get(this.projectId);
      let conflict: Error | null = null;
      request.onsuccess = () => {
        try {
          const current = request.result as Row | undefined;
          // A completed tombstone may be safely adopted. A live foreign draft may not.
          if (
            !backup &&
            (current?.token ?? null) !== this.token &&
            current?.record != null
          ) {
            conflict = new RecoveryWriteConflict();
            tx.abort();
            return;
          }
          if (backup) {
            const backups = tx.objectStore("backups");
            const next: BackupRow = {
              id: `${this.projectId}:${backup}:${nextToken}`,
              projectId: this.projectId,
              reason: backup,
              createdAt: Date.now(),
              record,
            };
            backups.put(next);
            const prior = backups
              .index("projectReason")
              .getAll([this.projectId, backup]);
            prior.onsuccess = () => {
              try {
                const previous = (prior.result as BackupRow[]).filter(
                  (row) => row.id !== next.id,
                );
                const order = (row: BackupRow) => row.order ?? row.createdAt;
                next.order =
                  previous.reduce(
                    (latest, row) => Math.max(latest, order(row)),
                    0,
                  ) + 1;
                backups.put(next);
                previous.sort(
                  (a, b) => order(b) - order(a) || b.id.localeCompare(a.id),
                );
                previous
                  .slice(RECOVERY_BACKUPS_PER_REASON - 1)
                  .forEach((row) => backups.delete(row.id));
              } catch (cause) {
                conflict =
                  cause instanceof Error
                    ? cause
                    : new Error(RECOVERY_STORAGE_WARNING);
                tx.abort();
              }
            };
          } else
            store.put(
              { token: nextToken, record } satisfies Row,
              this.projectId,
            );
        } catch (cause) {
          conflict =
            cause instanceof Error
              ? cause
              : new Error(RECOVERY_STORAGE_WARNING);
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        if (!backup) this.token = nextToken;
        resolve();
      };
      tx.onerror = () =>
        reject(conflict ?? tx.error ?? new Error(RECOVERY_STORAGE_WARNING));
      tx.onabort = tx.onerror;
    });
    // Removal follows the actual transaction completion; never remove another tab's newer legacy data.
    if (
      !backup &&
      this.legacyValue !== null &&
      this.legacy?.getItem(this.legacyKey) === this.legacyValue
    ) {
      this.legacy.removeItem(this.legacyKey);
      this.legacyValue = null;
    }
  }
  save(record: RecoveryJournal | null) {
    return this.serial(() => this.mutate(record));
  }
  backup(reason: "conflict" | "rejected", record: RecoveryJournal) {
    return this.serial(() => this.mutate(record, reason));
  }
  reopen() {
    this.lifecycle++;
    this.closing = false;
  }
  close() {
    const lifetime = ++this.lifecycle;
    this.closing = true;
    void this.operations
      .catch(() => undefined)
      .then(async () => {
        const db = await this.connection?.catch(() => undefined);
        if (lifetime !== this.lifecycle || !this.closing) return;
        db?.close();
        this.connection = null;
      });
  }
}

type PendingWrite = {
  snapshot: VideoProjectSnapshot;
  pending: WorkspacePendingOperation[];
  waiters: Array<() => void>;
};
/** No JSON stringify or IDB cloning in dispatch; coalesce pending writes in the next task. */
export class ScheduledRecoveryWriter {
  private queued: PendingWrite | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active: Promise<void> | null = null;
  private failed = false;
  private lifecycle = 0;
  constructor(
    readonly codec: RecoveryJournalCodec,
    private readonly store: WorkspaceRecoveryStore,
    private readonly report: (error: Error | null) => void,
  ) {}
  get pending() {
    return !!this.queued || !!this.active;
  }
  get unsettled() {
    return this.pending || this.failed;
  }
  write(
    snapshot: VideoProjectSnapshot,
    pending: readonly WorkspacePendingOperation[],
  ) {
    const captured = pending.map((operation) => ({ ...operation }));
    return new Promise<void>((resolve) => {
      const waiters = [...(this.queued?.waiters ?? []), resolve];
      this.queued = { snapshot, pending: captured, waiters };
      if (!this.active && this.timer === null)
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.pump();
        }, 0);
    });
  }
  private pump(): Promise<void> {
    if (this.active) return this.active;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.active = Promise.resolve()
      .then(async () => {
        while (this.queued) {
          const write = this.queued;
          this.queued = null;
          try {
            await this.store.save(
              write.pending.length
                ? this.codec.encode(write.snapshot, write.pending)
                : null,
            );
            this.failed = false;
            this.report(null);
          } catch (cause) {
            this.failed = true;
            this.report(
              cause instanceof Error
                ? cause
                : new Error(RECOVERY_STORAGE_WARNING),
            );
          } finally {
            write.waiters.forEach((resolve) => resolve());
          }
        }
      })
      .finally(() => {
        this.active = null;
        if (this.queued) void this.pump();
      });
    return this.active;
  }
  async flush() {
    while (this.queued || this.active) await this.pump();
  }
  async backup(
    reason: "conflict" | "rejected",
    snapshot: VideoProjectSnapshot,
    pending: readonly WorkspacePendingOperation[],
  ) {
    await this.flush();
    await this.store.backup(reason, this.codec.encode(snapshot, pending));
  }
  reopen() {
    this.lifecycle++;
    this.store.reopen?.();
  }
  close() {
    const lifetime = ++this.lifecycle;
    void this.flush().finally(() => {
      if (lifetime === this.lifecycle) this.store.close?.();
    });
  }
}

export function createBrowserWorkspaceRecoveryStore(
  projectId: string,
): WorkspaceRecoveryStore {
  let legacy: LegacyStorage | undefined;
  try {
    legacy = globalThis.localStorage;
  } catch {
    /* IndexedDB can still be usable when legacy storage is disabled. */
  }
  return new IndexedDBWorkspaceRecoveryStore(projectId, legacy);
}
