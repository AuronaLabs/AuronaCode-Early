/** Includes callers still loading their base snapshot, before they enter the disk queue. */
export class PendingWrites {
  private readonly pending = new Set<Promise<unknown>>();

  track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    const release = () => {
      this.pending.delete(operation);
    };
    void operation.then(release, release);
    return operation;
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.all(Array.from(this.pending));
  }
}
