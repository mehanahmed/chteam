import type { ReactNode } from "react";
import { useMessageActions } from "@/contexts/message-actions-context";
import type { GroupParticipant } from "@/hooks/useGroups";
import { cn } from "@/lib/utils";
import type { MentionedGroup, MentionParticipant } from "./group-mentions";
import { renderMarkdown } from "./markdown";

export { resolveMentionNames } from "./group-mentions";
export {
  CodeBlock,
  hasBlockElements,
  type MessageTextSegment,
  parseBlocks,
  parseInline,
  parseMessageLinks,
  renderMarkdown,
} from "./markdown";

export function LinkifiedText({
  text,
  isOwn,
  className,
  mentionParticipants = [],
  groupMentions = [],
  enableInteractions = true,
  trailing,
}: {
  text: string;
  isOwn: boolean;
  className?: string;
  groupMentions?: MentionedGroup[];
  mentionParticipants?: Pick<
    GroupParticipant,
    "jid" | "phoneNumber" | "mentionIds" | "displayName" | "contactId"
  >[];
  /** Disable nested controls when rendered inside another interactive element. */
  enableInteractions?: boolean;
  /**
   * Rendered inside the paragraph/block, after the text. A right-floated node put
   * here lands on the last line when it fits and drops to its own line when
   * it does not - which is how the bubble timestamp sits beside short
   * messages instead of always claiming a row of its own. It has to be part
   * of this inline formatting context to do that, so it is passed in rather
   * than rendered next to the paragraph.
   */
  trailing?: ReactNode;
}) {
  const { onOpenParticipantProfile } = useMessageActions();

  if (!text) {
    return trailing ? (
      <div
        className={cn(
          "whitespace-pre-wrap break-words",
          trailing && "after:block after:clear-both after:content-['']",
          className,
        )}
      >
        {trailing}
      </div>
    ) : null;
  }

  const content = renderMarkdown(text, {
    isOwn,
    enableInteractions,
    mentionParticipants: mentionParticipants as MentionParticipant[],
    groupMentions,
    onOpenParticipantProfile,
  });

  return (
    <div
      className={cn(
        "whitespace-pre-wrap break-words",
        trailing && "after:block after:clear-both after:content-['']",
        className,
      )}
    >
      {content}
      {trailing}
    </div>
  );
}
