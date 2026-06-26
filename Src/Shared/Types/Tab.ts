// 向后兼容 re-export，迁移至 Foundation 层
// icon 字段已移除（ReactNode 无法序列化到 JSON）
export type { TabType, TabItem } from "../../Foundation/Types/Tab";
