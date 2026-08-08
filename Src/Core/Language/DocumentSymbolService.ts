import { EventBus } from "../../Foundation/EventBus";
import { DocumentService } from "../DocumentService";
import { LspClient } from "./LspClient";

const MAX_CACHE_ENTRIES = 200;

interface SymbolCacheEntry {
  language: string;
  revision: number;
  symbols?: unknown[];
  inFlight?: Promise<unknown[]>;
}

/**
 * 轻量 Document Symbols 缓存：按「文档路径 + 文档版本 + 语言」命中，
 * 文档编辑（版本递增）自然失效，文件重命名/删除/切换工作区/LSP 重启时主动清理。
 * 仅解决同一文档同一版本的重复请求，不做统一语言架构。
 */
class DocumentSymbolServiceImpl {
  private readonly cache = new Map<string, SymbolCacheEntry>();
  private subscriptionsReady = false;

  async get(language: string, path: string): Promise<unknown[]> {
    this.ensureSubscriptions();
    const document = DocumentService.get(path);
    const revision = document?.version ?? -1;
    const existing = this.cache.get(path);
    if (existing && existing.language === language && existing.revision === revision) {
      if (existing.symbols) return existing.symbols;
      if (existing.inFlight) return existing.inFlight;
    }

    const entry: SymbolCacheEntry = { language, revision };
    const inFlight = LspClient.getInstance()
      .getDocumentSymbols(language, path)
      .then((symbols) => {
        entry.symbols = symbols;
        entry.inFlight = undefined;
        this.trim();
        return symbols;
      })
      .catch((error) => {
        this.cache.delete(path);
        throw error;
      });
    entry.inFlight = inFlight;
    this.cache.set(path, entry);
    return inFlight;
  }

  invalidate(path: string): void {
    this.cache.delete(path);
  }

  clear(): void {
    this.cache.clear();
  }

  private ensureSubscriptions(): void {
    if (this.subscriptionsReady) return;
    this.subscriptionsReady = true;
    EventBus.on("file:renamed", ({ oldPath }) => this.invalidate(oldPath));
    EventBus.on("file:deleted", ({ path }) => this.invalidate(path));
    EventBus.on("workspace:root-changed", () => this.clear());
    LspClient.getInstance().subscribe(() => this.clear());
  }

  private trim(): void {
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) return;
      this.cache.delete(oldest);
    }
  }
}

export const DocumentSymbolService = new DocumentSymbolServiceImpl();
