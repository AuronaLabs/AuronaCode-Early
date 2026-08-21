import { useState } from "react";
import { Icons } from "../../../UI/Icons/IconManager";

interface ExtensionIconProps {
  icon?: string;
  name?: string;
  size?: number;
  className?: string;
}

export function ExtensionIcon({
  icon,
  name = "Extension",
  size = 20,
  className = "",
}: ExtensionIconProps) {
  const [imageError, setImageError] = useState(false);

  if (!icon || imageError) {
    return <Icons.Extensions size={size} className={`text-blue-400 ${className}`} />;
  }

  const trimmed = icon.trim();

  // 1. 如果是以 <svg 开头的内联 SVG 字符串
  if (trimmed.startsWith("<svg") || (trimmed.startsWith("<") && trimmed.includes("</svg>"))) {
    return (
      <span
        style={{ width: size, height: size }}
        className={`flex items-center justify-center shrink-0 [&>svg]:size-full [&>svg]:object-contain ${className}`}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: verified extension SVG
        dangerouslySetInnerHTML={{ __html: trimmed }}
      />
    );
  }

  // 2. 如果是图片 URL (http, https, data:image, 相对路径, 带有图片后缀等)
  return (
    <img
      src={trimmed}
      alt={name}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      onError={() => setImageError(true)}
      className={`shrink-0 rounded-lg object-contain ${className}`}
    />
  );
}
