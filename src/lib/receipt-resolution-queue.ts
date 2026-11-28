export interface ReceiptResolutionTask<T> {
  key: string;
  roomId: string;
  run: () => Promise<T>;
}

/**
 * Small bounded queue for receipt target lookups. Identical in-flight keys are
 * coalesced, and tasks are skipped when their room is no longer active.
 */
export class ReceiptResolutionQueue<T> {
  private readonly pending: ReceiptResolutionTask<T>[] = [];
  private readonly active = new Set<string>();
  private running = 0;
  private disposed = false;

  private readonly concurrency: number;
  private readonly isActive: (_roomId: string) => boolean;

  constructor(concurrency: number, isActive: (_roomId: string) => boolean) {
    this.concurrency = Math.max(1, Math.floor(concurrency));
    this.isActive = isActive;
  }

  enqueue(task: ReceiptResolutionTask<T>): void {
    if (this.disposed || this.active.has(task.key)) return;
    this.active.add(task.key);
    this.pending.push(task);
    this.drain();
  }

  dispose(): void {
    this.disposed = true;
    this.pending.length = 0;
    this.active.clear();
  }

  private drain(): void {
    if (this.disposed) return;
    while (this.running < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift()!;
      if (!this.isActive(task.roomId)) {
        this.active.delete(task.key);
        continue;
      }
      this.running += 1;
      void task.run()
        .catch(() => {
          // An unresolved receipt never proves that a message was read.
        })
        .finally(() => {
          this.running -= 1;
          this.active.delete(task.key);
          this.drain();
        });
    }
  }
}
