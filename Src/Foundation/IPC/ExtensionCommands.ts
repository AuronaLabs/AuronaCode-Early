import { invokeDesktop, listenDesktop } from "../Desktop/Transport";
import { canonicalExtensionId } from "../Types/ExtensionId";

export type ExtensionPermissionState = "unknown" | "granted" | "denied";

export type ExtensionPermissionScope = "workspace" | "global" | "once";

export interface ExtensionPermissionDetail {
  state: ExtensionPermissionState;
  /** "global" / "workspace" / "once" / "unknown" */
  scope: string;
}

export interface ExtensionPermissionCatalogEntry {
  id: string;
  level: "normal" | "sensitive" | "critical";
  titleKey: string;
  descriptionKey: string;
  available: boolean;
}

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
  readme?: string;
  changelog?: string;
  sidebarTitle: string;
  displayTitle?: Record<string, string>;
  sidebarIcon: string;
  viewEntry: string;
  /** 扩展在 manifest 中声明的权限（后端安装期已审查） */
  permissions: string[];
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
  /** 活动编辑器的选中文本（宿主仅在已授权 editor.current.read 时注入上下文） */
  selectionText?: string | null;
  theme: string;
  accentColor?: string;
  colorScheme?: string;
  locale: string;
  fontWeight?: string;
  fontSize?: string;
}

/** 交互请求：payload 是扩展自定义的不透明数据（随动作回传给扩展） */
export interface ExtensionActionRequest {
  extensionId: string;
  actionId: string;
  payload: string;
  activeEditorPath: string | null;
  selectionText?: string | null;
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

export interface ExtensionEditorInsertEvent {
  extensionId: string;
  text: string;
}

export interface ExtensionEditorRevealEvent {
  extensionId: string;
  line: number;
}

export const ExtensionIPC = {
  list(): Promise<ExtensionDescriptor[]> {
    return invokeDesktop("extensions_list");
  },

  install(archiveBytes: number[], expectedSha256?: string): Promise<ExtensionDescriptor> {
    return invokeDesktop("extensions_install", { archiveBytes, expectedSha256 });
  },

  /** 安装本地 .vsix（VSCode 兼容路径），path 为文件选择器返回的绝对路径 */
  installVscode(path: string): Promise<ExtensionDescriptor> {
    return invokeDesktop("extensions_install_vscode", { path });
  },

  /** 一键安装随包内置的默认测试插件（vscode-demo.vsix） */
  installDefaultVscode(): Promise<ExtensionDescriptor> {
    return invokeDesktop("extensions_install_default_vscode", {});
  },

  uninstall(extensionId: string): Promise<void> {
    return invokeDesktop("extensions_uninstall", {
      extensionId: canonicalExtensionId(extensionId),
    });
  },

  getView(extensionId: string): Promise<ExtensionViewPayload> {
    return invokeDesktop("extensions_get_view", { extensionId: canonicalExtensionId(extensionId) });
  },

  getPermission(extensionId: string, permission: string): Promise<ExtensionPermissionDetail> {
    return invokeDesktop("extensions_get_permission", {
      extensionId: canonicalExtensionId(extensionId),
      permission,
    });
  },

  permissionCatalog(): Promise<ExtensionPermissionCatalogEntry[]> {
    return invokeDesktop("extensions_permission_catalog");
  },

  /** 撤销授权（恢复 unknown）；permission 省略 = 撤销该扩展全部权限 */
  revokePermission(extensionId: string, permission?: string): Promise<number> {
    return invokeDesktop("extensions_revoke_permission", {
      extensionId: canonicalExtensionId(extensionId),
      permission: permission ?? null,
    });
  },

  setPermission(
    extensionId: string,
    permission: string,
    granted: boolean,
    scope: ExtensionPermissionScope = "workspace",
  ): Promise<ExtensionPermissionState> {
    return invokeDesktop("extensions_set_permission", {
      extensionId: canonicalExtensionId(extensionId),
      permission,
      granted,
      scope,
    });
  },

  setSessionPermission(
    extensionId: string,
    permission: string,
    granted: boolean,
  ): Promise<ExtensionPermissionState> {
    return invokeDesktop("extensions_set_session_permission", {
      extensionId: canonicalExtensionId(extensionId),
      permission,
      granted,
    });
  },

  render(request: ExtensionRenderRequest): Promise<ExtensionRenderResponse> {
    return invokeDesktop("extensions_render", {
      request: { ...request, extensionId: canonicalExtensionId(request.extensionId) },
    });
  },

  /** 把用户在渲染视图中的动作交给扩展，返回下一帧渲染（请求-响应，扩展跨调用无状态） */
  onAction(request: ExtensionActionRequest): Promise<ExtensionRenderResponse> {
    return invokeDesktop("extensions_on_action", {
      request: { ...request, extensionId: canonicalExtensionId(request.extensionId) },
    });
  },

  /** 订阅扩展触发的编辑器插入文本事件（editor.current.write 已在后端强制校验） */
  onEditorInsertText(listener: (payload: ExtensionEditorInsertEvent) => void) {
    return listenDesktop("extension://editor/insert-text", listener);
  },

  /** 订阅扩展触发的编辑器行定位事件（editor.current.write 已在后端强制校验） */
  onEditorRevealLine(listener: (payload: ExtensionEditorRevealEvent) => void) {
    return listenDesktop("extension://editor/reveal-line", listener);
  },
};
