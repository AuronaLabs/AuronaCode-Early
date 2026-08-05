import { useState } from "react";

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
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={`grid shrink-0 select-none place-items-center overflow-hidden rounded-full border border-[var(--border-subtle)] bg-[var(--material-surface)] font-semibold text-[var(--color-accent)] ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(7, size * 0.32) }}
    >
      {picture && !failed ? (
        <img
          src={picture}
          alt={`${name} 的头像`}
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{profileInitial(name)}</span>
      )}
    </div>
  );
}
