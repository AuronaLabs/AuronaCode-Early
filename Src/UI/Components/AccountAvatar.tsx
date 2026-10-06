import { useState } from "react";
import { useLocale } from "../../Foundation/I18n";
import { useRestrictedImage } from "../../Foundation/Security/RestrictedImage";

function profileInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "A";
}

interface AccountAvatarProps {
  name: string;
  picture: string | null;
  size?: number;
  className?: string;
}

export function AccountAvatar({ name, picture, size = 112, className = "" }: AccountAvatarProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const resource = useRestrictedImage(picture);
  const { t } = useLocale();
  return (
    <div
      className={`grid shrink-0 select-none place-items-center overflow-hidden rounded-full border border-[var(--border-subtle)] bg-[var(--material-surface)] font-semibold text-[var(--color-accent)] ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(7, size * 0.32) }}
    >
      {resource && failedSource !== picture ? (
        <img
          src={resource}
          alt={`${t("account.avatarAlt")}${name}`}
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailedSource(picture)}
        />
      ) : (
        <span aria-hidden="true">{profileInitial(name)}</span>
      )}
    </div>
  );
}
