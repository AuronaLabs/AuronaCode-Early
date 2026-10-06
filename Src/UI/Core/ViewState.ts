import {
  createContext,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useViewActivity } from "./ViewActivity";

export class ViewStateStore {
  private readonly views = new Map<string, Map<string, unknown>>();
  private readonly leases = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  constructor(private readonly capacity = 12) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  version = (): number => this.revision;

  protectedIds(): string[] {
    return Array.from(this.leases.keys());
  }

  hold(id: string): () => void {
    if (!this.leases.has(id) && this.leases.size >= this.capacity - 1) {
      throw new Error("[resource.limit] Protected view slots are full");
    }
    this.leases.set(id, (this.leases.get(id) ?? 0) + 1);
    this.changed();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.leases.get(id) ?? 0;
      if (count <= 1) this.leases.delete(id);
      else this.leases.set(id, count - 1);
      this.changed();
    };
  }

  private changed(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  read<T>(id: string, key: string): T | undefined {
    return this.views.get(id)?.get(key) as T | undefined;
  }

  write<T>(id: string, key: string, value: T): void {
    let view = this.views.get(id);
    if (!view) {
      view = new Map();
      this.views.set(id, view);
    }
    view.set(key, value);
  }

  retain(ids: readonly string[]): void {
    const open = new Set(ids);
    for (const id of this.views.keys()) if (!open.has(id)) this.views.delete(id);
  }
}

export function useViewLease(needed: boolean): void {
  const context = useContext(ViewStateContext);
  const store = context?.store;
  const id = context?.id;
  useLayoutEffect(() => {
    if (needed && store && id) return store.hold(id);
  }, [needed, store, id]);
}

export const ViewStateContext = createContext<{ store: ViewStateStore; id: string } | null>(null);

// Only small presentation state belongs here. Documents and credentials have
// their own backend stores and must never be retained in the view cache.
export function useRetainedViewState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(ViewStateContext);
  const store = context?.store;
  const id = context?.id;
  const [value, setValue] = useState<T>(
    () =>
      context?.store.read<T>(context.id, key) ??
      (typeof initial === "function" ? (initial as () => T)() : initial),
  );
  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setValue((previous) => {
        const resolved = typeof next === "function" ? (next as (value: T) => T)(previous) : next;
        if (store && id) store.write(id, key, resolved);
        return resolved;
      });
    },
    [store, id, key],
  );
  return [value, update];
}

export function useRetainedScroll(key: string) {
  const context = useContext(ViewStateContext);
  const store = context?.store;
  const id = context?.id;
  const active = useViewActivity();
  const element = useRef<HTMLDivElement | null>(null);
  const restore = useCallback(
    (node: HTMLDivElement | null) => {
      element.current = node;
      if (!node || !active || !store || !id) return;
      const position = store.read<{ top: number; left: number }>(id, key);
      if (position) {
        node.scrollTop = position.top;
        node.scrollLeft = position.left;
      }
    },
    [active, store, id, key],
  );
  useLayoutEffect(() => {
    restore(element.current);
  }, [restore]);
  const onScroll = useCallback(() => {
    const node = element.current;
    if (active && node && store && id)
      store.write(id, key, { top: node.scrollTop, left: node.scrollLeft });
  }, [active, store, id, key]);
  return { ref: restore, onScroll };
}
