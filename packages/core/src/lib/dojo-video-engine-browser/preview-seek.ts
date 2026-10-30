/** Interactive seeks retain one running and one latest pending target. Exact
 * capture/export seeks remain separate and can wait for clearPending(). */
export class PreviewSeekQueue {
  private pending: {
    frame: number;
    resolve: (presented: boolean) => void;
    reject: (error: unknown) => void;
  } | null = null;
  private running: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly render: (frame: number) => Promise<void>) {}

  seek(frame: number): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    this.pending?.resolve(false);
    const result = new Promise<boolean>((resolve, reject) => {
      this.pending = { frame, resolve, reject };
    });
    this.start();
    return result;
  }

  private start(): void {
    if (this.running || this.closed || !this.pending) return;
    this.running = this.run().finally(() => {
      this.running = null;
      this.start();
    });
  }

  private async run(): Promise<void> {
    while (this.pending && !this.closed) {
      const request = this.pending;
      this.pending = null;
      try {
        await this.render(request.frame);
        request.resolve(!this.closed && !this.pending);
      } catch (error) {
        request.reject(error);
      }
    }
  }

  clearPending(): Promise<void> {
    this.pending?.resolve(false);
    this.pending = null;
    return this.running ?? Promise.resolve();
  }

  dispose(): void {
    this.closed = true;
    void this.clearPending();
  }
}
