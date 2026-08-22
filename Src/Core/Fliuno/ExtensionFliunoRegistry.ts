/**
 * Aurona Code 全局扩展 Fliuno 动态搜索源注册表
 * 归属 Core 层核心服务，供 Fliuno 搜索内核与 Aurona SDK 单向消费
 */

export interface FliunoCustomItem {
  id: string;
  title: string;
  detail?: string;
  icon?: string;
  onSelect: () => void | Promise<void>;
}

export interface FliunoCustomProvider {
  id: string;
  title: string;
  search: (query: string) => Promise<FliunoCustomItem[]> | FliunoCustomItem[];
}

class ExtensionFliunoProviderRegistry {
  private readonly providers = new Map<string, FliunoCustomProvider>();

  register(provider: FliunoCustomProvider): () => void {
    this.providers.set(provider.id, provider);
    return () => {
      this.providers.delete(provider.id);
    };
  }

  getProviders(): FliunoCustomProvider[] {
    return Array.from(this.providers.values());
  }
}

export const ExtensionFliunoRegistry = new ExtensionFliunoProviderRegistry();
