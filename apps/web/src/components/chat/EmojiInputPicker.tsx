import { useEffect, useRef } from "react";
import EmojiPicker, {
  EmojiStyle,
  Theme,
  type EmojiClickData,
  SuggestionMode,
} from "emoji-picker-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts";

interface EmojiInputPickerProps {
  onSelectEmoji: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiInputPicker({
  onSelectEmoji,
  onClose,
}: EmojiInputPickerProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    onSelectEmoji(emojiData.emoji);
    onClose();
  };

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full mb-2 left-0 z-20 shadow-2xl rounded-2xl overflow-hidden border border-gray-200 dark:border-dark-border"
    >
      <EmojiPicker
        onEmojiClick={handleEmojiClick}
        emojiStyle={EmojiStyle.FACEBOOK}
        theme={resolvedTheme === "dark" ? Theme.DARK : Theme.LIGHT}
        lazyLoadEmojis={true}
        searchPlaceHolder={t("chat.searchEmoji", "Search emoji…")}
        previewConfig={{ showPreview: false }}
        suggestedEmojisMode={SuggestionMode.RECENT}
        width={340}
        height={400}
      />
    </div>
  );
}

export default EmojiInputPicker;
