/**
 * Aurona Code 官方原生声明式组件协议定义 (Declarative Component Schema)
 * 允许插件无需编写 HTML/CSS，直接声明式复用 Aurona 官方全套现代拟物组件
 */

export type DeclarativeComponent =
  | DeclarativeCard
  | DeclarativeSelect
  | DeclarativeButton
  | DeclarativeSwitch
  | DeclarativeInput
  | DeclarativeBadge
  | DeclarativeText
  | DeclarativeProgressBar
  | DeclarativeGrid
  | DeclarativeContainer
  | DeclarativeSeparator;

export interface DeclarativeContainer {
  type: "container";
  id?: string;
  direction?: "vertical" | "horizontal";
  gap?: number;
  children: DeclarativeComponent[];
}

export interface DeclarativeGrid {
  type: "grid";
  id?: string;
  columns: number;
  gap?: number;
  children: DeclarativeComponent[];
}

export interface DeclarativeCard {
  type: "card";
  id?: string;
  title?: string;
  subtitle?: string;
  icon?: string;
  children: DeclarativeComponent[];
}

export interface DeclarativeSelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface DeclarativeSelect {
  type: "select";
  id: string;
  label?: string;
  value: string;
  options: DeclarativeSelectOption[];
  disabled?: boolean;
}

export interface DeclarativeButton {
  type: "button";
  id: string;
  label: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  icon?: string;
  disabled?: boolean;
  action: string;
}

export interface DeclarativeSwitch {
  type: "switch";
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
}

export interface DeclarativeInput {
  type: "input";
  id: string;
  label?: string;
  placeholder?: string;
  value?: string;
  inputType?: "text" | "number" | "password";
  disabled?: boolean;
}

export interface DeclarativeBadge {
  type: "badge";
  id?: string;
  text: string;
  color?: "blue" | "green" | "amber" | "purple" | "neutral";
}

export interface DeclarativeText {
  type: "text";
  id?: string;
  content: string;
  variant?: "title" | "subtitle" | "body" | "caption" | "code";
}

export interface DeclarativeProgressBar {
  type: "progress";
  id?: string;
  progress: number; // 0 to 100
  label?: string;
}

export interface DeclarativeSeparator {
  type: "separator";
  id?: string;
}

/**
 * 官方原生声明式 UI 根对象契约
 */
export interface DeclarativeUIRoot {
  mode: "declarative";
  title?: string;
  description?: string;
  components: DeclarativeComponent[];
}

export function isDeclarativeUI(data: unknown): data is DeclarativeUIRoot {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).mode === "declarative" &&
    Array.isArray((data as Record<string, unknown>).components)
  );
}
