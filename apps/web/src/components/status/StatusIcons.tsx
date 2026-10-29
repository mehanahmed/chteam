import React from "react";

/**
 * WhatsApp 3-arc Status Navigation Icon
 */
export function WhatsAppStatusNavIcon({
  className = "h-[18px] w-[18px]",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="8.5"
        strokeDasharray="14.5 3.3"
        strokeDashoffset="2"
      />
    </svg>
  );
}

/**
 * WhatsApp Large 3-arc Splash Status Icon
 * Exactly matching media_1793263527934_a20c85a1.png
 */
export function StatusSplashIcon({
  className = "w-16 h-16 text-[#8696a0]",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle
        cx="32"
        cy="32"
        r="22"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeDasharray="38 8"
        strokeDashoffset="10"
        strokeLinecap="round"
      />
      <circle
        cx="32"
        cy="32"
        r="13.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeOpacity="0.4"
      />
    </svg>
  );
}

/**
 * Plus in circle icon for adding status
 */
export function StatusAddIcon({
  className = "w-5 h-5 text-[#54656f] dark:text-[#aebac1]",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

/**
 * WhatsApp Status Ring around an Avatar
 * Supports single continuous ring or multi-segmented ring based on count
 */
export function StatusRing({
  children,
  count = 1,
  seenCount = 0,
  size = 46,
  strokeWidth = 2.5,
  className = "",
}: {
  children: React.ReactNode;
  count?: number;
  seenCount?: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeCount = Math.max(1, count);
  const gap = safeCount > 1 ? 4 : 0;
  const arcLength = (circumference - gap * safeCount) / safeCount;

  return (
    <div
      className={`relative flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        className="absolute inset-0 -rotate-90 pointer-events-none"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        {Array.from({ length: safeCount }).map((_, i) => {
          const isSeen = i < seenCount;
          const strokeColor = isSeen ? "#8696a0" : "#00a884";
          const offset = i * (arcLength + gap);

          return (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeDasharray={`${arcLength} ${circumference - arcLength}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <div className="relative rounded-full overflow-hidden w-[38px] h-[38px] flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}
