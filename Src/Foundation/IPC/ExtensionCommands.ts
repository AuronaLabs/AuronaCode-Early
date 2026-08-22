import { invokeDesktop } from "../Desktop/Transport";

export type ExtensionPermissionState = "unknown" | "granted" | "denied";

export interface ExtensionMarketplaceInfo {
  categories?: string[];
  tags?: string[];
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  rating?: number;
  downloads?: number;
}

export interface ExtensionDescriptor {
  id: string;
  name: string;
  displayName?: Record<string, string>;
  publisher: string;
  version: string;
  description?: string;
  displayDescription?: Record<string, string>;
  sidebarTitle: string;
  displayTitle?: Record<string, string>;
  sidebarIcon: string;
  viewEntry: string;
  marketplace?: ExtensionMarketplaceInfo;
}

export interface ExtensionViewPayload {
  html: string;
  icon: string;
}

export interface ExtensionRenderRequest {
  extensionId: string;
  markdown: string;
  activeEditorPath: string | null;
  theme: string;
  accentColor?: string;
  colorScheme?: string;
  locale: string;
  fontWeight?: string;
  fontSize?: string;
}

export interface ExtensionRenderMetrics {
  packageOpenMs: number;
  wasmCompileMs: number;
  renderMs: number;
}

export interface ExtensionRenderResponse {
  html: string;
  diagnostics: string[];
  metrics: ExtensionRenderMetrics;
}

export const ExtensionIPC = {
  list(): Promise<ExtensionDescriptor[]> {
    return invokeDesktop("extensions_list");
  },

  install(archiveBytes: number[], expectedSha256?: string): Promise<ExtensionDescriptor> {
    return invokeDesktop("extensions_install", { archiveBytes, expectedSha256 });
  },

  uninstall(extensionId: string): Promise<void> {
    return invokeDesktop("extensions_uninstall", { extensionId });
  },

  getView(extensionId: string): Promise<ExtensionViewPayload> {
    return invokeDesktop("extensions_get_view", { extensionId });
  },

  getPermission(extensionId: string, permission: string): Promise<ExtensionPermissionState> {
    return invokeDesktop("extensions_get_permission", { extensionId, permission });
  },

  setPermission(
    extensionId: string,
    permission: string,
    granted: boolean,
  ): Promise<ExtensionPermissionState> {
    return invokeDesktop("extensions_set_permission", {
      extensionId,
      permission,
      granted,
    });
  },

  setSessionPermission(
    extensionId: string,
    permission: string,
    granted: boolean,
  ): Promise<ExtensionPermissionState> {
    return invokeDesktop("extensions_set_session_permission", {
      extensionId,
      permission,
      granted,
    });
  },

  render(request: ExtensionRenderRequest): Promise<ExtensionRenderResponse> {
    return invokeDesktop("extensions_render", { request });
  },
};
