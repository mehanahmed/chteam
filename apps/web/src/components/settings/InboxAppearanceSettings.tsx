import { Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface PatternOption {
  id: string;
  name: string;
  thumbUrl?: string;
  gradient?: string;
}

const PATTERNS: PatternOption[] = [
  {
    id: "none",
    name: "None",
    gradient:
      "radial-gradient(960px 640px at 8% 6%, rgba(191, 215, 255, 0.55), rgba(0, 0, 0, 0) 55%), radial-gradient(880px 608px at 100% 0%, rgba(248, 243, 234, 0.9), rgba(0, 0, 0, 0) 60%), radial-gradient(1120px 800px at 70% 100%, rgba(220, 235, 255, 0.55), rgba(0, 0, 0, 0) 60%), linear-gradient(135deg, rgb(248, 243, 234) 0%, rgb(238, 247, 255) 48%, rgb(255, 255, 255) 100%)",
  },
  {
    id: "marbel",
    name: "Marbel",
    thumbUrl: "/patterns/bg-1-thumb.png",
  },
  {
    id: "artboard",
    name: "Artboard",
    thumbUrl: "/patterns/bg-2-thumb.png",
  },
  {
    id: "bacteria",
    name: "Bacteria",
    thumbUrl: "/patterns/bg-3-thumb.png",
  },
  {
    id: "business",
    name: "Business",
    thumbUrl: "/patterns/bg-4-thumb.png",
  },
  {
    id: "business-icons",
    name: "Business Icons",
    thumbUrl: "/patterns/bg-5-thumb.png",
  },
  {
    id: "dot",
    name: "Dot",
    thumbUrl: "/patterns/bg-6-thumb.png",
  },
  {
    id: "geometry",
    name: "Geometry",
    thumbUrl: "/patterns/bg-7-thumb.png",
  },
  {
    id: "jamdani",
    name: "Jamdani",
    thumbUrl: "/patterns/bg-8-thumb.png",
  },
  {
    id: "streamline",
    name: "Streamline",
    thumbUrl: "/patterns/bg-9-thumb.png",
  },
];

export const INBOX_PATTERN_STORAGE_KEY = "chatdesk-inbox-pattern";
export const CHANNEL_SPECIFIC_BG_STORAGE_KEY = "chatdesk-channel-specific-bg";
export const COLORFUL_AVATARS_STORAGE_KEY = "chatdesk-colorful-avatars";

export function InboxAppearanceSettings() {
  const [selectedPattern, setSelectedPattern] = useState<string>(() => {
    try {
      return localStorage.getItem(INBOX_PATTERN_STORAGE_KEY) || "jamdani";
    } catch {
      return "jamdani";
    }
  });

  const [channelSpecificBg, setChannelSpecificBg] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(CHANNEL_SPECIFIC_BG_STORAGE_KEY);
      return stored !== null ? stored === "true" : true;
    } catch {
      return true;
    }
  });

  const [colorfulAvatars, setColorfulAvatars] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(COLORFUL_AVATARS_STORAGE_KEY);
      return stored !== null ? stored === "true" : true;
    } catch {
      return true;
    }
  });

  const handleSelectPattern = (id: string, name: string) => {
    setSelectedPattern(id);
    try {
      localStorage.setItem(INBOX_PATTERN_STORAGE_KEY, id);
      window.dispatchEvent(new Event("storage"));
    } catch {
      // Ignore
    }
    toast.success(`Inbox pattern set to "${name}"`);
  };

  const handleToggleChannelSpecific = () => {
    const nextVal = !channelSpecificBg;
    setChannelSpecificBg(nextVal);
    try {
      localStorage.setItem(CHANNEL_SPECIFIC_BG_STORAGE_KEY, String(nextVal));
      window.dispatchEvent(new Event("storage"));
    } catch {
      // Ignore
    }
    toast.info(
      nextVal
        ? "Channel specific backgrounds enabled"
        : "Channel specific backgrounds disabled",
    );
  };

  const handleToggleColorfulAvatars = () => {
    const nextVal = !colorfulAvatars;
    setColorfulAvatars(nextVal);
    try {
      localStorage.setItem(COLORFUL_AVATARS_STORAGE_KEY, String(nextVal));
      window.dispatchEvent(new Event("storage"));
    } catch {
      // Ignore
    }
    toast.info(
      nextVal ? "Colorful avatars enabled" : "Standard initial avatars enabled",
    );
  };

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <header className="mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-[1.8rem] font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-100 sm:text-[2rem]">
              Inbox Appearance
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
              Choose a background pattern for the inbox thread.
            </p>
          </div>
        </div>
      </header>

      {/* Pattern Grid Card */}
      <section className="rounded-[18px] border border-[#cfe1ff] bg-white px-6 py-6 shadow-none dark:border-slate-800 dark:bg-slate-900 transition-all">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">
            Pattern
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {PATTERNS.map((pattern) => {
            const isSelected = selectedPattern === pattern.id;
            return (
              <button
                key={pattern.id}
                type="button"
                onClick={() => handleSelectPattern(pattern.id, pattern.name)}
                className="group text-center focus:outline-none"
              >
                <div
                  className={cn(
                    "relative h-28 w-full rounded-2xl border transition-all duration-200",
                    isSelected
                      ? "border-[#2B6BFF] ring-2 ring-[#2B6BFF]/35 shadow-sm"
                      : "border-slate-200 hover:border-blue-200 dark:border-slate-700 dark:hover:border-slate-500",
                  )}
                  style={
                    pattern.gradient
                      ? { backgroundImage: pattern.gradient }
                      : {
                          backgroundImage: `url("${pattern.thumbUrl}")`,
                          backgroundSize: "cover",
                          backgroundPosition: "center center",
                          backgroundRepeat: "no-repeat",
                        }
                  }
                >
                  {isSelected && (
                    <span className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-full bg-[#2B6BFF] text-white shadow-sm">
                      <Check className="size-3.5" />
                    </span>
                  )}
                </div>
                <p
                  className={cn(
                    "mt-2 text-sm font-medium transition-colors",
                    isSelected
                      ? "text-[#2B6BFF] font-semibold"
                      : "text-slate-500 group-hover:text-slate-800 dark:text-slate-400 dark:group-hover:text-slate-200",
                  )}
                >
                  {pattern.name}
                </p>
              </button>
            );
          })}
        </div>

        {/* Channel Specific Background Checkbox Card */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-[#0f1724]">
          <button
            type="button"
            onClick={handleToggleChannelSpecific}
            className="flex w-full items-start gap-3 text-left focus:outline-none"
          >
            <span
              className={cn(
                "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-white transition-all",
                channelSpecificBg
                  ? "bg-[#2B6BFF]"
                  : "border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800",
              )}
            >
              {channelSpecificBg && <Check className="size-3.5" />}
            </span>

            <span className="block">
              <span className="block text-base font-semibold text-slate-900 dark:text-slate-100">
                Channel specific background
              </span>
              <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">
                By selecting this checkbox, channel specific backgrounds will
                override the selected pattern.
              </span>
            </span>
          </button>
        </div>
      </section>

      {/* User Avatars Section */}
      <div className="mt-6">
        <section className="rounded-[18px] border border-[#cfe1ff] bg-white px-6 py-6 shadow-none dark:border-slate-800 dark:bg-slate-900 transition-all">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">
              User Avatars
            </h3>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-[#0f1724]">
            <div className="flex items-center justify-between gap-4">
              {/* Overlapping Colorful SVG Avatars */}
              <div className="flex shrink-0 items-center">
                {/* Avatar 1: Yellow */}
                <span className="inline-block shrink-0 overflow-hidden rounded-full shadow-sm">
                  <svg
                    viewBox="0 0 36 36"
                    fill="none"
                    role="img"
                    xmlns="http://www.w3.org/2000/svg"
                    width="40"
                    height="40"
                  >
                    <mask
                      id="_r_1b_avatar"
                      maskUnits="userSpaceOnUse"
                      x="0"
                      y="0"
                      width="36"
                      height="36"
                    >
                      <rect width="36" height="36" rx="72" fill="#FFFFFF" />
                    </mask>
                    <g mask="url(#_r_1b_avatar)">
                      <rect width="36" height="36" fill="#FFC53D" />
                      <rect
                        x="0"
                        y="0"
                        width="36"
                        height="36"
                        transform="translate(-1 -1) rotate(345 18 18) scale(1)"
                        fill="#FFF7CC"
                        rx="36"
                      />
                      <g transform="translate(-1 -4) rotate(5 18 18)">
                        <path
                          d="M15 19c2 1 4 1 6 0"
                          stroke="#000000"
                          fill="none"
                          strokeLinecap="round"
                        />
                        <rect
                          x="14"
                          y="14"
                          width="1.5"
                          height="2"
                          rx="1"
                          stroke="none"
                          fill="#000000"
                        />
                        <rect
                          x="20"
                          y="14"
                          width="1.5"
                          height="2"
                          rx="1"
                          stroke="none"
                          fill="#000000"
                        />
                      </g>
                    </g>
                  </svg>
                </span>

                {/* Avatar 2: Green */}
                <span className="inline-block shrink-0 overflow-hidden rounded-full -ml-2 shadow-sm">
                  <svg
                    viewBox="0 0 36 36"
                    fill="none"
                    role="img"
                    xmlns="http://www.w3.org/2000/svg"
                    width="40"
                    height="40"
                  >
                    <mask
                      id="_r_1c_avatar"
                      maskUnits="userSpaceOnUse"
                      x="0"
                      y="0"
                      width="36"
                      height="36"
                    >
                      <rect width="36" height="36" rx="72" fill="#FFFFFF" />
                    </mask>
                    <g mask="url(#_r_1c_avatar)">
                      <rect width="36" height="36" fill="#D9F7BE" />
                      <rect
                        x="0"
                        y="0"
                        width="36"
                        height="36"
                        transform="translate(1 1) rotate(323 18 18) scale(1.2)"
                        fill="#95DE64"
                        rx="36"
                      />
                      <g transform="translate(-3 -4) rotate(-3 18 18)">
                        <path
                          d="M15 21c2 1 4 1 6 0"
                          stroke="#000000"
                          fill="none"
                          strokeLinecap="round"
                        />
                        <rect
                          x="11"
                          y="14"
                          width="1.5"
                          height="2"
                          rx="1"
                          stroke="none"
                          fill="#000000"
                        />
                        <rect
                          x="23"
                          y="14"
                          width="1.5"
                          height="2"
                          rx="1"
                          stroke="none"
                          fill="#000000"
                        />
                      </g>
                    </g>
                  </svg>
                </span>

                {/* Avatar 3: Purple */}
                <span className="inline-block shrink-0 overflow-hidden rounded-full -ml-2 shadow-sm">
                  <svg
                    viewBox="0 0 36 36"
                    fill="none"
                    role="img"
                    xmlns="http://www.w3.org/2000/svg"
                    width="40"
                    height="40"
                  >
                    <mask
                      id="_r_1d_avatar"
                      maskUnits="userSpaceOnUse"
                      x="0"
                      y="0"
                      width="36"
                      height="36"
                    >
                      <rect width="36" height="36" rx="72" fill="#FFFFFF" />
                    </mask>
                    <g mask="url(#_r_1d_avatar)">
                      <rect width="36" height="36" fill="#D3ADF7" />
                      <rect
                        x="0"
                        y="0"
                        width="36"
                        height="36"
                        transform="translate(-5 -5) rotate(349 18 18) scale(1.1)"
                        fill="#9254DE"
                        rx="36"
                      />
                      <g transform="translate(-5 -1) rotate(-9 18 18)">
                        <path
                          d="M15 20c2 1 4 1 6 0"
                          stroke="#FFFFFF"
                          fill="none"
                          strokeLinecap="round"
                        />
                        <rect
                          x="10"
                          y="14"
                          width="1.5"
                          height="2"
                          rx="1"
                          stroke="none"
                          fill="#FFFFFF"
                        />
                        <rect
                          x="24"
                          y="14"
                          width="1.5"
                          height="2"
                          rx="1"
                          stroke="none"
                          fill="#FFFFFF"
                        />
                      </g>
                    </g>
                  </svg>
                </span>
              </div>

              {/* Title & Description */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Colorful avatars
                </p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  Replace plain initials with vibrant generated avatars in the
                  inbox, conversation list and call log. Turn off to use simple
                  initials.
                </p>
              </div>

              {/* Accessible Toggle Button */}
              <button
                type="button"
                role="switch"
                aria-checked={colorfulAvatars}
                onClick={handleToggleColorfulAvatars}
                className={cn(
                  "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F53FF] focus-visible:ring-offset-2",
                  colorfulAvatars ? "bg-[#1F53FF]" : "bg-slate-300 dark:bg-slate-700",
                )}
              >
                <span
                  className={cn(
                    "absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform",
                    colorfulAvatars ? "translate-x-5" : "translate-x-0",
                  )}
                />
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
