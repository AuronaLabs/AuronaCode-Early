import { getBuildChannel, type ReleaseChannel } from "../Release/ReleaseChannel";
import { UserConfigStore } from "../Storage/UserConfigStore";
import { FEATURE_FLAG_MAP, OFFICIAL_FEATURE_FLAGS } from "./FeatureFlagRegistry";

let cachedChannel: ReleaseChannel | null = null;
let isInitialized = false;

/**
 * 官方 Feature Flag 运行时判定服务
 * 铁律：Feature Flags 是版本特性的物理开关，由发行渠道（Stable / Pioneer）严格判定，不可由用户单项篡改。
 */
export const FeatureFlagService = {
  /**
   * 初始化并从本地用户配置读取渠道偏好
   */
  async init(): Promise<void> {
    if (isInitialized) return;
    try {
      const config = await UserConfigStore.get();
      cachedChannel = config.releaseChannel ?? getBuildChannel();
      isInitialized = true;
    } catch {
      cachedChannel = getBuildChannel();
      isInitialized = true;
    }
  },

  /**
   * 获取当前生效的发行渠道（若用户在高级设置中配置了渠道则使用配置，否则使用编译期默认渠道）
   */
  getChannel(): ReleaseChannel {
    if (cachedChannel) return cachedChannel;
    return getBuildChannel();
  },

  /**
   * 切换发行渠道（Stable / Pioneer）
   */
  async setChannel(channel: ReleaseChannel): Promise<void> {
    cachedChannel = channel;
    await UserConfigStore.set({ releaseChannel: channel });
  },

  /**
   * 计算指定 Feature Flag 在当前渠道下的开闭状态
   */
  isEnabled(flagId: string): boolean {
    const def = FEATURE_FLAG_MAP.get(flagId);
    if (!def) return false;

    const channel = this.getChannel();
    return def.defaultByChannel[channel] ?? false;
  },

  /**
   * 获取全量 Feature Flags 在当前渠道下的状态字典
   */
  getAllFlags(): Record<string, boolean> {
    const channel = this.getChannel();
    const result: Record<string, boolean> = {};

    for (const flag of OFFICIAL_FEATURE_FLAGS) {
      result[flag.id] = flag.defaultByChannel[channel] ?? false;
    }

    return result;
  },
};
