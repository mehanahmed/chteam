import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Send,
  Smile,
  Volume2,
  VolumeX,
  X,
  Plus,
  Palette,
  Type,
} from "lucide-react";
import { useAuth } from "../contexts/auth-context";
import { StatusSplashIcon, StatusAddIcon, StatusRing } from "../components/status/StatusIcons";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { cn } from "../lib/utils";
import { toast } from "sonner";
import { fetchWithAuth } from "../lib/api/client";

export interface StatusItem {
  id: string;
  type: "text" | "image" | "video";
  content?: string;
  mediaUrl?: string;
  backgroundColor?: string;
  fontFamily?: string;
  caption?: string;
  timestamp: string;
  expiresAt: string;
}

export interface ContactStatus {
  id: string;
  jid: string;
  name: string;
  avatarUrl: string;
  timestamp: string;
  isOwn?: boolean;
  statuses: StatusItem[];
}

const TEXT_STATUS_COLORS = [
  "#702d4e", // Deep maroon / plum
  "#00a884", // WhatsApp emerald green
  "#0b5796", // Classic teal
  "#1d3557", // Deep navy
  "#d0473e", // Sunset coral
  "#2a3942", // Charcoal
  "#5b21b6", // Royal purple
  "#b45309", // Warm amber
];

const FONTS = [
  { id: "sans", name: "Sans", class: "font-sans" },
  { id: "serif", name: "Serif", class: "font-serif italic" },
  { id: "mono", name: "Monospace", class: "font-mono font-bold" },
];

const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "🙏", "👏"];

export function StatusPage() {
  const { user } = useAuth();

  // Seeded statuses matching exactly the reference image:
  // 1. +8801811974259 - Today at 2:30 PM
  // 2. Petni Apu 👻 - Yesterday at 10:38 PM
  const initialContacts: ContactStatus[] = useMemo(
    () => [
      {
        id: "c-1",
        jid: "8801811974259@s.whatsapp.net",
        name: "+8801811974259",
        avatarUrl:
          "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&crop=faces",
        timestamp: "Today at 2:30 PM",
        statuses: [
          {
            id: "s-1-1",
            type: "image",
            mediaUrl:
              "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&h=1000&fit=crop&crop=faces",
            caption: "Chilling out on the highway 🚗✨",
            timestamp: "Today at 2:30 PM",
            expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          },
          {
            id: "s-1-2",
            type: "text",
            content: "Never stop learning and exploring!",
            backgroundColor: "#0b5796",
            fontFamily: "font-sans",
            timestamp: "Today at 2:32 PM",
            expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          },
        ],
      },
      {
        id: "c-2",
        jid: "petni_apu@s.whatsapp.net",
        name: "Petni Apu 👻",
        avatarUrl:
          "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=120&h=120&fit=crop&crop=center",
        timestamp: "Yesterday at 10:38 PM",
        statuses: [
          {
            id: "s-2-1",
            type: "image",
            mediaUrl:
              "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1000&h=1200&fit=crop&crop=center",
            caption: "Calm evening waves 🌊🌅",
            timestamp: "Yesterday at 10:38 PM",
            expiresAt: new Date(Date.now() + 18 * 3600 * 1000).toISOString(),
          },
        ],
      },
    ],
    [],
  );

  const [contactList, setContactList] = useState<ContactStatus[]>(initialContacts);

  // My Status local storage
  const [myStatuses, setMyStatuses] = useState<StatusItem[]>(() => {
    try {
      const stored = localStorage.getItem("omniteam_my_statuses");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Active Story Viewer State
  const [activeStoryContact, setActiveStoryContact] = useState<ContactStatus | null>(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [isStoryPaused, setIsStoryPaused] = useState(false);
  const [storyProgress, setStoryProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [storyReplyText, setStoryReplyText] = useState("");

  // Modals for creating status
  const [isTextStatusOpen, setIsTextStatusOpen] = useState(false);
  const [textStatusContent, setTextStatusContent] = useState("");
  const [selectedBgColor, setSelectedBgColor] = useState(TEXT_STATUS_COLORS[0]);
  const [selectedFontIndex, setSelectedFontIndex] = useState(0);

  const [isMediaStatusOpen, setIsMediaStatusOpen] = useState(false);
  const [selectedMediaUrl, setSelectedMediaUrl] = useState<string | null>(null);
  const [selectedMediaType, setSelectedMediaType] = useState<"image" | "video">("image");
  const [mediaCaption, setMediaCaption] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save myStatuses to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("omniteam_my_statuses", JSON.stringify(myStatuses));
    } catch {
      // Safe fallback
    }
  }, [myStatuses]);

  // Load live statuses from backend if available
  useEffect(() => {
    let isCancelled = false;
    async function loadApiStatuses() {
      try {
        const response = await fetchWithAuth<any>("/status");
        if (response && Array.isArray(response) && response.length > 0 && !isCancelled) {
          const apiContacts: ContactStatus[] = response.map((item: any, idx: number) => ({
            id: `api-${idx}`,
            jid: item.jid,
            name: item.jid.replace("@s.whatsapp.net", ""),
            avatarUrl: "",
            timestamp: "Today",
            statuses: item.statuses.map((s: any) => ({
              id: s.id,
              type: s.mediaType || "text",
              content: s.caption || "",
              mediaUrl: s.mediaUrl,
              timestamp: new Date(s.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
              expiresAt: s.expiresAt,
            })),
          }));
          setContactList((prev) => [...prev, ...apiContacts]);
        }
      } catch {
        // Fallback to seeded statuses
      }
    }
    void loadApiStatuses();
    return () => {
      isCancelled = true;
    };
  }, []);

  // Story Viewer Auto-Advance Timer (5 seconds per status)
  useEffect(() => {
    if (!activeStoryContact) return;

    if (isStoryPaused) return;

    const interval = 50; // update every 50ms
    const totalDuration = 5000; // 5 seconds
    const step = (interval / totalDuration) * 100;

    const timer = setInterval(() => {
      setStoryProgress((prev) => {
        if (prev >= 100) {
          // Advance to next story or close
          if (activeStoryIndex < activeStoryContact.statuses.length - 1) {
            setActiveStoryIndex((curr) => curr + 1);
            return 0;
          } else {
            // Find next contact or close viewer
            const currentIndex = contactList.findIndex(
              (c) => c.id === activeStoryContact.id,
            );
            if (currentIndex !== -1 && currentIndex < contactList.length - 1) {
              setActiveStoryContact(contactList[currentIndex + 1]);
              setActiveStoryIndex(0);
              return 0;
            } else {
              setActiveStoryContact(null);
              return 0;
            }
          }
        }
        return prev + step;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [activeStoryContact, activeStoryIndex, isStoryPaused, contactList]);

  // Open story handler
  const handleOpenStory = (contact: ContactStatus, startIndex = 0) => {
    setActiveStoryContact(contact);
    setActiveStoryIndex(startIndex);
    setStoryProgress(0);
    setIsStoryPaused(false);
  };

  const handleNextStory = useCallback(() => {
    if (!activeStoryContact) return;
    if (activeStoryIndex < activeStoryContact.statuses.length - 1) {
      setActiveStoryIndex((prev) => prev + 1);
      setStoryProgress(0);
    } else {
      const currIdx = contactList.findIndex((c) => c.id === activeStoryContact.id);
      if (currIdx !== -1 && currIdx < contactList.length - 1) {
        setActiveStoryContact(contactList[currIdx + 1]);
        setActiveStoryIndex(0);
        setStoryProgress(0);
      } else {
        setActiveStoryContact(null);
      }
    }
  }, [activeStoryContact, activeStoryIndex, contactList]);

  const handlePrevStory = useCallback(() => {
    if (!activeStoryContact) return;
    if (activeStoryIndex > 0) {
      setActiveStoryIndex((prev) => prev - 1);
      setStoryProgress(0);
    } else {
      const currIdx = contactList.findIndex((c) => c.id === activeStoryContact.id);
      if (currIdx > 0) {
        const prevContact = contactList[currIdx - 1];
        setActiveStoryContact(prevContact);
        setActiveStoryIndex(prevContact.statuses.length - 1);
        setStoryProgress(0);
      }
    }
  }, [activeStoryContact, activeStoryIndex, contactList]);

  // Handle keyboard shortcuts for story viewer
  useEffect(() => {
    if (!activeStoryContact) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveStoryContact(null);
      } else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        handleNextStory();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrevStory();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeStoryContact, handleNextStory, handlePrevStory]);

  // Submit Text Status
  const handlePostTextStatus = async () => {
    if (!textStatusContent.trim()) return;

    const newStatus: StatusItem = {
      id: `my-${Date.now()}`,
      type: "text",
      content: textStatusContent.trim(),
      backgroundColor: selectedBgColor,
      fontFamily: FONTS[selectedFontIndex].class,
      timestamp: "Just now",
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    };

    setMyStatuses((prev) => [newStatus, ...prev]);
    setIsTextStatusOpen(false);
    setTextStatusContent("");
    toast.success("Status updated!");

    try {
      await fetchWithAuth("/status", {
        method: "POST",
        body: JSON.stringify({
          type: "text",
          content: newStatus.content,
        }),
      });
    } catch {
      // Local status state already persisted
    }
  };

  // Submit Photo/Video Status
  const handlePostMediaStatus = async () => {
    if (!selectedMediaUrl) return;

    const newStatus: StatusItem = {
      id: `my-${Date.now()}`,
      type: selectedMediaType,
      mediaUrl: selectedMediaUrl,
      caption: mediaCaption.trim() || undefined,
      timestamp: "Just now",
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    };

    setMyStatuses((prev) => [newStatus, ...prev]);
    setIsMediaStatusOpen(false);
    setSelectedMediaUrl(null);
    setMediaCaption("");
    toast.success("Status updated!");

    try {
      await fetchWithAuth("/status", {
        method: "POST",
        body: JSON.stringify({
          type: selectedMediaType,
          content: newStatus.caption,
          mediaUrl: newStatus.mediaUrl,
        }),
      });
    } catch {
      // Local status state already persisted
    }
  };

  // Handle file select from file picker
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith("video/");
    setSelectedMediaType(isVideo ? "video" : "image");

    const objectUrl = URL.createObjectURL(file);
    setSelectedMediaUrl(objectUrl);
    setIsMediaStatusOpen(true);
    e.target.value = "";
  };

  // Reply to story
  const handleSendStoryReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!storyReplyText.trim() || !activeStoryContact) return;

    toast.success(`Reply sent to ${activeStoryContact.name}`);
    setStoryReplyText("");
  };

  const handleQuickReaction = (emoji: string) => {
    if (!activeStoryContact) return;
    toast.success(`Reacted ${emoji} to ${activeStoryContact.name}'s status`);
  };

  // My Status object for viewer
  const myStatusContact: ContactStatus | null = useMemo(() => {
    if (myStatuses.length === 0) return null;
    return {
      id: "my-status",
      jid: "me@s.whatsapp.net",
      name: "My status",
      avatarUrl: user?.avatarUrl || "",
      timestamp: myStatuses[0]?.timestamp || "Today",
      isOwn: true,
      statuses: myStatuses,
    };
  }, [myStatuses, user?.avatarUrl]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-white dark:bg-[#111b21]">
      {/* =======================================================
          LEFT SIDEBAR: Status Overview (Pixel-Perfect WhatsApp Web)
      ======================================================== */}
      <aside className="w-full md:w-[380px] lg:w-[400px] shrink-0 border-r border-[#e9edef] dark:border-[#222d34] flex flex-col h-full bg-white dark:bg-[#111b21] select-none">
        {/* Header */}
        <header className="h-[60px] px-4 flex items-center justify-between border-b border-[#e9edef] dark:border-[#222d34]">
          <h1 className="text-[20px] font-bold text-[#111b21] dark:text-[#e9edef] tracking-tight">
            Status
          </h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsTextStatusOpen(true)}
              className="p-2 rounded-full text-[#54656f] dark:text-[#aebac1] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] transition-colors"
              title="New status"
              aria-label="New status"
            >
              <StatusAddIcon className="w-5 h-5" />
            </button>
            <button
              type="button"
              className="p-2 rounded-full text-[#54656f] dark:text-[#aebac1] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] transition-colors"
              title="More options"
              aria-label="More options"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Scrollable Status Items */}
        <div className="flex-1 overflow-y-auto">
          {/* "My status" Row */}
          <div
            onClick={() => {
              if (myStatusContact && myStatusContact.statuses.length > 0) {
                handleOpenStory(myStatusContact);
              } else {
                setIsTextStatusOpen(true);
              }
            }}
            className="flex items-center gap-3.5 px-4 py-3 cursor-pointer hover:bg-[#f5f6f6] dark:hover:bg-[#202c33] transition-colors"
          >
            <div className="relative shrink-0">
              {myStatuses.length > 0 ? (
                <StatusRing count={myStatuses.length} size={46}>
                  <Avatar className="w-[38px] h-[38px]">
                    <AvatarImage src={user?.avatarUrl} alt={user?.name || "User"} />
                    <AvatarFallback className="bg-[#00a884] text-white font-medium text-sm">
                      {user?.name?.slice(0, 2).toUpperCase() || "ME"}
                    </AvatarFallback>
                  </Avatar>
                </StatusRing>
              ) : (
                <div className="relative w-10 h-10">
                  <Avatar className="w-10 h-10">
                    <AvatarImage src={user?.avatarUrl} alt={user?.name || "User"} />
                    <AvatarFallback className="bg-emerald-600 text-white font-medium text-sm">
                      {user?.name?.slice(0, 2).toUpperCase() || "ME"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] bg-[#00a884] rounded-full flex items-center justify-center border-2 border-white dark:border-[#111b21] text-white shadow-sm">
                    <Plus className="w-3 h-3 stroke-[3]" />
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-[16px] font-medium text-[#111b21] dark:text-[#e9edef] leading-tight">
                My status
              </span>
              <span className="text-[13px] text-[#667781] dark:text-[#8696a0] leading-tight mt-0.5 truncate">
                {myStatuses.length > 0
                  ? myStatuses[0].timestamp
                  : "Click to add status update"}
              </span>
            </div>
          </div>

          {/* Section Divider: "Recent" */}
          <div className="px-4 pt-4 pb-2">
            <span className="text-[13.5px] font-semibold text-[#008069] dark:text-[#00a884] tracking-wide">
              Recent
            </span>
          </div>

          {/* Contact Status Items */}
          <div className="divide-y divide-transparent">
            {contactList.map((contact) => (
              <div
                key={contact.id}
                onClick={() => handleOpenStory(contact)}
                className="flex items-center gap-3.5 px-4 py-3 cursor-pointer hover:bg-[#f5f6f6] dark:hover:bg-[#202c33] transition-colors"
              >
                <StatusRing count={contact.statuses.length} size={46}>
                  <Avatar className="w-[38px] h-[38px]">
                    <AvatarImage src={contact.avatarUrl} alt={contact.name} />
                    <AvatarFallback className="bg-[#202c33] text-white font-medium text-xs">
                      {contact.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </StatusRing>

                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-[16px] font-medium text-[#111b21] dark:text-[#e9edef] leading-tight truncate">
                    {contact.name}
                  </span>
                  <span className="text-[13px] text-[#667781] dark:text-[#8696a0] leading-tight mt-0.5">
                    {contact.timestamp}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* =======================================================
          RIGHT MAIN AREA: Share Statuses Splash (Identical Match)
      ======================================================== */}
      <main className="hidden md:flex flex-1 flex-col items-center justify-center bg-[#f0f2f5] dark:bg-[#111b21] px-6 select-none relative">
        <div className="flex flex-col items-center text-center max-w-md">
          {/* Centered WhatsApp Status Splash Icon */}
          <div className="mb-2">
            <StatusSplashIcon className="w-16 h-16 text-[#8696a0] dark:text-[#8696a0]" />
          </div>

          {/* Heading */}
          <h2 className="text-[28px] md:text-[32px] font-light text-[#111b21] dark:text-[#e9edef] mt-4 tracking-tight leading-snug">
            Share statuses
          </h2>

          {/* Subtitle */}
          <p className="text-[14px] text-[#667781] dark:text-[#8696a0] mt-2 leading-relaxed">
            Share photos, videos and text that disappear after 24 hours.
          </p>

          {/* Action Buttons */}
          <div className="flex items-center justify-center gap-12 mt-8">
            {/* Text status button */}
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => setIsTextStatusOpen(true)}
                className="w-14 h-14 rounded-full bg-[#e9edef] dark:bg-[#202c33] hover:bg-[#d9dbdc] dark:hover:bg-[#2a3942] flex items-center justify-center shadow-sm transition-all hover:scale-105 active:scale-95 cursor-pointer text-[#54656f] dark:text-[#aebac1]"
                aria-label="Text status"
              >
                <Pencil className="w-[22px] h-[22px]" />
              </button>
              <span className="text-[13px] text-[#111b21] dark:text-[#e9edef] mt-2.5 font-normal">
                Text status
              </span>
            </div>

            {/* Photo and video button */}
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-14 h-14 rounded-full bg-[#e9edef] dark:bg-[#202c33] hover:bg-[#d9dbdc] dark:hover:bg-[#2a3942] flex items-center justify-center shadow-sm transition-all hover:scale-105 active:scale-95 cursor-pointer text-[#54656f] dark:text-[#aebac1]"
                aria-label="Photo and video"
              >
                <Camera className="w-[22px] h-[22px]" />
              </button>
              <span className="text-[13px] text-[#111b21] dark:text-[#e9edef] mt-2.5 font-normal">
                Photo and video
              </span>
            </div>
          </div>
        </div>

        {/* Hidden File Input for Image/Video Status Upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </main>

      {/* =======================================================
          STORY VIEWER: WhatsApp Full-Screen Story Overlay
      ======================================================== */}
      {activeStoryContact && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 select-none"
          onMouseDown={() => setIsStoryPaused(true)}
          onMouseUp={() => setIsStoryPaused(false)}
          onTouchStart={() => setIsStoryPaused(true)}
          onTouchEnd={() => setIsStoryPaused(false)}
        >
          {/* Main Story Container */}
          <div className="relative w-full max-w-[480px] h-full max-h-[92vh] flex flex-col justify-between p-4">
            {/* Top Header & Progress Bars */}
            <div className="w-full flex flex-col gap-3 z-20">
              {/* Segmented Progress Bars */}
              <div className="flex items-center gap-1.5 w-full">
                {activeStoryContact.statuses.map((_, idx) => (
                  <div
                    key={idx}
                    className="h-1 flex-1 bg-white/30 rounded-full overflow-hidden"
                  >
                    <div
                      className="h-full bg-white transition-all duration-75 ease-linear rounded-full"
                      style={{
                        width:
                          idx < activeStoryIndex
                            ? "100%"
                            : idx === activeStoryIndex
                              ? `${storyProgress}%`
                              : "0%",
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* Contact Info Header */}
              <div className="flex items-center justify-between text-white">
                <div className="flex items-center gap-3">
                  <Avatar className="w-10 h-10 border border-white/20">
                    <AvatarImage
                      src={activeStoryContact.avatarUrl}
                      alt={activeStoryContact.name}
                    />
                    <AvatarFallback className="bg-[#202c33] text-white">
                      {activeStoryContact.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="text-[15px] font-semibold leading-tight drop-shadow-sm">
                      {activeStoryContact.name}
                    </span>
                    <span className="text-[12px] text-white/70 leading-tight">
                      {activeStoryContact.statuses[activeStoryIndex]?.timestamp ||
                        activeStoryContact.timestamp}
                    </span>
                  </div>
                </div>

                {/* Story Controls */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsStoryPaused((p) => !p);
                    }}
                    className="p-1.5 text-white/80 hover:text-white"
                    aria-label={isStoryPaused ? "Play" : "Pause"}
                  >
                    {isStoryPaused ? (
                      <Play className="w-5 h-5 fill-current" />
                    ) : (
                      <Pause className="w-5 h-5 fill-current" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsMuted((m) => !m);
                    }}
                    className="p-1.5 text-white/80 hover:text-white"
                    aria-label={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted ? (
                      <VolumeX className="w-5 h-5" />
                    ) : (
                      <Volume2 className="w-5 h-5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveStoryContact(null);
                    }}
                    className="p-1.5 text-white/80 hover:text-white"
                    aria-label="Close"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </div>

            {/* Story Content Area (Image / Video / Text) */}
            <div className="relative flex-1 my-3 flex items-center justify-center overflow-hidden rounded-2xl shadow-2xl">
              {/* Left & Right Click Navigators */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrevStory();
                }}
                className="absolute left-2 z-20 p-2 rounded-full bg-black/30 text-white/70 hover:text-white hover:bg-black/50 transition-colors"
                aria-label="Previous story"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNextStory();
                }}
                className="absolute right-2 z-20 p-2 rounded-full bg-black/30 text-white/70 hover:text-white hover:bg-black/50 transition-colors"
                aria-label="Next story"
              >
                <ChevronRight className="w-6 h-6" />
              </button>

              {/* Status Payload */}
              {activeStoryContact.statuses[activeStoryIndex]?.type === "text" ? (
                <div
                  className="w-full h-full flex items-center justify-center p-8 text-center"
                  style={{
                    backgroundColor:
                      activeStoryContact.statuses[activeStoryIndex]?.backgroundColor ||
                      "#702d4e",
                  }}
                >
                  <p
                    className={cn(
                      "text-2xl md:text-3xl text-white font-medium leading-relaxed break-words",
                      activeStoryContact.statuses[activeStoryIndex]?.fontFamily,
                    )}
                  >
                    {activeStoryContact.statuses[activeStoryIndex]?.content}
                  </p>
                </div>
              ) : activeStoryContact.statuses[activeStoryIndex]?.type === "video" ? (
                <div className="relative w-full h-full bg-black flex items-center justify-center">
                  <video
                    src={activeStoryContact.statuses[activeStoryIndex]?.mediaUrl}
                    autoPlay
                    loop
                    muted={isMuted}
                    playsInline
                    className="w-full h-full object-contain"
                  />
                  {activeStoryContact.statuses[activeStoryIndex]?.caption && (
                    <div className="absolute bottom-4 inset-x-4 bg-black/60 backdrop-blur-sm p-3 rounded-xl text-white text-center text-sm">
                      {activeStoryContact.statuses[activeStoryIndex]?.caption}
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative w-full h-full bg-black flex items-center justify-center">
                  <img
                    src={activeStoryContact.statuses[activeStoryIndex]?.mediaUrl}
                    alt="Status story"
                    className="w-full h-full object-contain"
                  />
                  {activeStoryContact.statuses[activeStoryIndex]?.caption && (
                    <div className="absolute bottom-4 inset-x-4 bg-black/60 backdrop-blur-sm p-3 rounded-xl text-white text-center text-sm">
                      {activeStoryContact.statuses[activeStoryIndex]?.caption}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Reply Bar */}
            <div className="flex flex-col gap-2 z-20">
              {/* Quick Reactions */}
              <div className="flex items-center justify-center gap-3">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleQuickReaction(emoji);
                    }}
                    className="text-2xl hover:scale-125 transition-transform active:scale-95 p-1"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {/* Reply Form */}
              <form
                onSubmit={handleSendStoryReply}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2 bg-white/10 backdrop-blur-md rounded-full px-4 py-2 border border-white/20"
              >
                <button
                  type="button"
                  className="text-white/70 hover:text-white"
                  title="Emoji"
                >
                  <Smile className="w-5 h-5" />
                </button>
                <input
                  type="text"
                  value={storyReplyText}
                  onChange={(e) => setStoryReplyText(e.target.value)}
                  placeholder="Type a reply..."
                  className="flex-1 bg-transparent text-white placeholder-white/60 text-sm focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!storyReplyText.trim()}
                  className="text-[#00a884] disabled:opacity-40 hover:scale-110 transition-transform"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* =======================================================
          TEXT STATUS CREATOR MODAL
      ======================================================== */}
      {isTextStatusOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div
            className="relative w-full max-w-[500px] h-[600px] rounded-2xl flex flex-col justify-between p-6 shadow-2xl transition-colors duration-200"
            style={{ backgroundColor: selectedBgColor }}
          >
            {/* Top Toolbar */}
            <div className="flex items-center justify-between text-white">
              <button
                type="button"
                onClick={() => setIsTextStatusOpen(false)}
                className="p-2 rounded-full hover:bg-black/20 transition-colors"
                aria-label="Close"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="flex items-center gap-3">
                {/* Font cycle */}
                <button
                  type="button"
                  onClick={() =>
                    setSelectedFontIndex((prev) => (prev + 1) % FONTS.length)
                  }
                  className="p-2 rounded-full hover:bg-black/20 transition-colors flex items-center gap-1 text-sm font-semibold"
                  title="Change font"
                >
                  <Type className="w-5 h-5" />
                  <span>{FONTS[selectedFontIndex].name}</span>
                </button>

                {/* Color cycle */}
                <button
                  type="button"
                  onClick={() => {
                    const currentIdx = TEXT_STATUS_COLORS.indexOf(selectedBgColor);
                    const nextColor =
                      TEXT_STATUS_COLORS[(currentIdx + 1) % TEXT_STATUS_COLORS.length];
                    setSelectedBgColor(nextColor);
                  }}
                  className="p-2 rounded-full hover:bg-black/20 transition-colors"
                  title="Change background color"
                >
                  <Palette className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Centered Large Textarea */}
            <div className="flex-1 flex items-center justify-center px-4">
              <textarea
                value={textStatusContent}
                onChange={(e) => setTextStatusContent(e.target.value)}
                placeholder="Type a status"
                autoFocus
                rows={4}
                className={cn(
                  "w-full bg-transparent text-white placeholder-white/50 text-2xl md:text-3xl font-medium text-center focus:outline-none resize-none leading-relaxed",
                  FONTS[selectedFontIndex].class,
                )}
              />
            </div>

            {/* Bottom Actions: Floating Send Button */}
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={handlePostTextStatus}
                disabled={!textStatusContent.trim()}
                className="w-13 h-13 rounded-full bg-[#00a884] hover:bg-[#008f6f] text-white flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 cursor-pointer"
                title="Send status"
              >
                <Send className="w-6 h-6 translate-x-0.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =======================================================
          PHOTO / VIDEO STATUS CREATOR MODAL
      ======================================================== */}
      {isMediaStatusOpen && selectedMediaUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
          <div className="relative w-full max-w-[500px] h-[640px] bg-[#111b21] rounded-2xl flex flex-col justify-between overflow-hidden shadow-2xl">
            {/* Top Bar */}
            <div className="h-14 px-4 flex items-center justify-between text-white border-b border-white/10 z-10">
              <button
                type="button"
                onClick={() => {
                  setIsMediaStatusOpen(false);
                  setSelectedMediaUrl(null);
                }}
                className="p-2 rounded-full hover:bg-white/10 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
              <span className="text-sm font-medium">New status</span>
              <div className="w-10" />
            </div>

            {/* Media Preview */}
            <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden p-2">
              {selectedMediaType === "video" ? (
                <video
                  src={selectedMediaUrl}
                  controls
                  className="max-h-full max-w-full object-contain rounded-lg"
                />
              ) : (
                <img
                  src={selectedMediaUrl}
                  alt="Selected media preview"
                  className="max-h-full max-w-full object-contain rounded-lg"
                />
              )}
            </div>

            {/* Bottom Caption & Send Bar */}
            <div className="p-4 bg-[#202c33] flex items-center gap-3">
              <input
                type="text"
                value={mediaCaption}
                onChange={(e) => setMediaCaption(e.target.value)}
                placeholder="Add a caption..."
                className="flex-1 bg-[#2a3942] text-white placeholder-[#8696a0] rounded-lg px-4 py-2.5 text-sm focus:outline-none"
              />
              <button
                type="button"
                onClick={handlePostMediaStatus}
                className="w-11 h-11 rounded-full bg-[#00a884] hover:bg-[#008f6f] text-white flex items-center justify-center shadow-md transition-transform hover:scale-105 active:scale-95 shrink-0"
                title="Send status"
              >
                <Send className="w-5 h-5 translate-x-0.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StatusPage;
