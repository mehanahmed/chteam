import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface AssignedUserBadgeProps {
  name: string;
  avatarUrl?: string | null;
  className?: string;
}

export const AssignedUserBadge = memo(function AssignedUserBadge({
  name,
  avatarUrl,
  className,
}: AssignedUserBadgeProps) {
  const { t } = useTranslation();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const showImage = Boolean(avatarUrl && failedUrl !== avatarUrl);

  const initials = useMemo(() => {
    const trimmed = (name || "").trim();
    if (!trimmed) return "U";
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
  }, [name]);

  const label = t("contacts.assignedToMember", `Assigned to ${name}`, {
    name,
  });

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 shrink-0 rounded-full bg-gray-100 dark:bg-dark-tertiary pl-0.5 pr-2 py-0.5 text-[10px] font-medium text-gray-700 dark:text-dark-text-secondary ring-1 ring-inset ring-gray-200/80 dark:ring-dark-border/80 max-w-[120px]",
        className,
      )}
      title={label}
      aria-label={label}
    >
      <span className="relative flex size-4 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-dark-secondary">
        {showImage ? (
          <img
            src={avatarUrl!}
            alt={name}
            className="size-full object-cover rounded-full"
            onError={() => setFailedUrl(avatarUrl!)}
          />
        ) : (
          <span className="flex size-full items-center justify-center bg-whatsapp-teal-green/20 text-whatsapp-teal-green text-[9px] font-bold leading-none select-none">
            {initials}
          </span>
        )}
      </span>
      <span className="truncate max-w-[70px] leading-tight">{name}</span>
    </span>
  );
});

export default AssignedUserBadge;
