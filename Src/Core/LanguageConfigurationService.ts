import { EventBus } from "../Foundation/EventBus";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";
import type { LanguageServerConfiguration } from "../Foundation/Types/Config";
import { FileSystemService } from "./FileSystemService";
import { WorkspaceService } from "./WorkspaceService";

interface WorkspaceLanguageConfiguration {
  languages?: Record<
    string,
    {
      server?: LanguageServerConfiguration;
      languageId?: string;
      fileExtensions?: string[];
      rootPatterns?: string[];
    }
  >;
}

export class WorkspaceTrustRequiredError extends Error {
  constructor(readonly root: string) {
    super(`工作区尚未授权执行语言服务器：${root}`);
    this.name = "WorkspaceTrustRequiredError";
  }
}

class LanguageConfigurationServiceImpl {
  private pendingTrustRequest: { root: string; language: string } | null = null;

  private requestTrust(root: string, language: string): void {
    const request = { root, language: language || "workspace" };
    this.pendingTrustRequest = request;
    EventBus.emit("workspace:trust-request", request);
  }

  /** Replays a trust request after the main workbench has mounted. */
  flushPendingTrustRequest(): void {
    const request = this.pendingTrustRequest;
    if (!request) return;
    this.pendingTrustRequest = null;
    EventBus.emit("workspace:trust-request", request);
  }

  async checkWorkspaceTrust(language = "workspace"): Promise<boolean> {
    const root = WorkspaceService.getCurrent().primaryRoot;
    if (!root) return false;
    const configurationPath = FileSystemService.joinPath(root, ".aurona/language-services.json");
    if (!(await FileSystemService.exists(configurationPath))) return false;
    const user = await UserConfigStore.get();
    const trusted = (user.trustedWorkspaceRoots ?? []).some(
      (trustedRoot) => normalize(trustedRoot) === normalize(root),
    );
    WorkspaceService.setTrusted(trusted);
    if (!trusted) this.requestTrust(root, language);
    return !trusted;
  }

  async resolve(language: string): Promise<LanguageServerConfiguration> {
    const root = WorkspaceService.getCurrent().primaryRoot;
    const user = await UserConfigStore.get();
    const userConfiguration = user.languageServers?.[language];
    if (!root) return userConfiguration ?? {};

    const configurationPath = FileSystemService.joinPath(root, ".aurona/language-services.json");
    if (!(await FileSystemService.exists(configurationPath))) {
      return userConfiguration ?? {};
    }
    const trusted = (user.trustedWorkspaceRoots ?? []).some(
      (trustedRoot) => normalize(trustedRoot) === normalize(root),
    );
    if (!trusted) {
      this.requestTrust(root, language);
      throw new WorkspaceTrustRequiredError(root);
    }
    WorkspaceService.setTrusted(true);
    const parsed = JSON.parse(
      await FileSystemService.readTextFile(configurationPath),
    ) as WorkspaceLanguageConfiguration;
    return {
      ...userConfiguration,
      ...(parsed.languages?.[language]?.server ?? {}),
    };
  }

  async trust(root: string): Promise<void> {
    const config = await UserConfigStore.get();
    const roots = new Set((config.trustedWorkspaceRoots ?? []).map(normalize));
    roots.add(normalize(root));
    await UserConfigStore.set({ trustedWorkspaceRoots: [...roots] });
    WorkspaceService.setTrusted(true);
  }
}

const normalize = (path: string) => path.replace(/[\\/]+$/, "").toLowerCase();

export const LanguageConfigurationService = new LanguageConfigurationServiceImpl();
