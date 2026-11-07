export type Disposer = () => void;

/** Owns resources acquired by one lifecycle, including registrations that finish late. */
export class DisposableScope {
  private disposers: Disposer[] = [];
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  add(dispose: Disposer): void {
    if (this.disposed) dispose();
    else this.disposers.push(dispose);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const dispose of this.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "Resource cleanup failed");
  }
}
