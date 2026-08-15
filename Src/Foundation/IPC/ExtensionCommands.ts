import { invokeDesktop } from "../Desktop/Transport";

export type ExtensionPermissionState = "unknown" | "granted" | "denied";

export interface ExtensionDescriptor {
  id: string;
  name: string;
  publisher: string;
  version: string;
  sidebarTitle: string;
  sidebarIcon: string;
  viewEntry: string;
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
  locale: string;
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

  render(request: ExtensionRenderRequest): Promise<ExtensionRenderResponse> {
    return invokeDesktop("extensions_render", { request });
  },
};
