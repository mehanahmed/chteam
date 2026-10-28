import { useEffect, useState } from "react";

const patternUrl = (fill: string, opacity: string) =>
  `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='${fill}' fill-opacity='${opacity}'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`;

const PATTERN_FILE_MAP: Record<string, string> = {
  marbel: "/patterns/bg-1-thumb.png",
  artboard: "/patterns/bg-2-thumb.png",
  bacteria: "/patterns/bg-3-thumb.png",
  business: "/patterns/bg-4-thumb.png",
  "business-icons": "/patterns/bg-5-thumb.png",
  dot: "/patterns/bg-6-thumb.png",
  geometry: "/patterns/bg-7-thumb.png",
  jamdani: "/patterns/bg-8-thumb.png",
  streamline: "/patterns/bg-9-thumb.png",
};

/** Base fill for the canvas itself, kept next to the texture it carries. */
export const CONVERSATION_CANVAS_CLASS = "bg-[#e5ddd5] dark:bg-dark-primary";

export function ConversationCanvasPattern() {
  const [pattern, setPattern] = useState<string>(() => {
    try {
      return localStorage.getItem("chatdesk-inbox-pattern") || "jamdani";
    } catch {
      return "jamdani";
    }
  });

  useEffect(() => {
    const handleStorageChange = () => {
      try {
        const stored = localStorage.getItem("chatdesk-inbox-pattern") || "jamdani";
        setPattern(stored);
      } catch {
        // Ignore
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const customBgUrl = PATTERN_FILE_MAP[pattern];

  if (pattern === "none") {
    return null;
  }

  if (customBgUrl) {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.08] dark:opacity-[0.06] bg-repeat"
        style={{
          backgroundImage: `url("${customBgUrl}")`,
          backgroundSize: "280px auto",
        }}
      />
    );
  }

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.055] dark:hidden"
        style={{ backgroundImage: patternUrl("%23000000", "1") }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden opacity-90 dark:block"
        style={{ backgroundImage: patternUrl("%231a2730", "0.4") }}
      />
    </>
  );
}
