import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import type { MentionedGroup, MentionParticipant } from "./group-mentions";

export interface MessageTextSegment {
  type: "text" | "link";
  value: string;
  href?: string;
}

const LINK_PATTERN =
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|(?:https?:\/\/|www\.)[^\s<>]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>]*)?/gi;
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const SIMPLE_TRAILING_PUNCTUATION = /[.,!?;:]+$/;

const MENTION_PATTERN =
  /(^|[\s([{\*_~])@(\d+(?:-\d+)?@g\.us)(?!\w|\.[a-z0-9])|(^|[\s([{\*_~])@(\d{5,20})\b(?![@-])/g;

export function trimTrailingPunctuation(value: string): {
  link: string;
  trailing: string;
} {
  let link = value;
  let trailing = "";
  const simpleMatch = link.match(SIMPLE_TRAILING_PUNCTUATION);
  if (simpleMatch) {
    trailing = simpleMatch[0];
    link = link.slice(0, -trailing.length);
  }

  const pairs: Array<[string, string]> = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ];
  for (const [open, close] of pairs) {
    while (
      link.endsWith(close) &&
      link.split(close).length > link.split(open).length
    ) {
      link = link.slice(0, -1);
      trailing = close + trailing;
    }
  }

  return { link, trailing };
}

export function toSafeHref(value: string): string | null {
  const candidate = EMAIL_PATTERN.test(value)
    ? `mailto:${value}`
    : /^https?:\/\//i.test(value)
      ? value
      : `https://${value}`;
  try {
    const url = new URL(candidate);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Split untrusted message text into plain text and safe HTTP(S) links. */
export function parseMessageLinks(text: string): MessageTextSegment[] {
  const segments: MessageTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LINK_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, start) });
    }

    const matchedValue = match[0];
    const { link, trailing } = trimTrailingPunctuation(matchedValue);
    const href = toSafeHref(link);
    if (href) {
      segments.push({ type: "link", value: link, href });
    } else {
      segments.push({ type: "text", value: link });
    }
    if (trailing) segments.push({ type: "text", value: trailing });
    cursor = start + matchedValue.length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function displayMentionName(participant: MentionParticipant): string {
  return participant.displayName.trim().replace(/^@/, "");
}

function buildParticipantMap(
  participants: MentionParticipant[],
): Map<string, MentionParticipant> {
  const map = new Map<string, MentionParticipant>();
  for (const p of participants) {
    if (!displayMentionName(p)) continue;
    const jidUser = p.jid.split("@")[0]?.split(":")[0] || "";
    const ids = [jidUser, p.phoneNumber || "", ...(p.mentionIds ?? [])];
    for (const id of ids) {
      const clean = digitsOnly(id);
      if (clean) map.set(clean, p);
    }
  }
  return map;
}

export interface MarkdownRenderOptions {
  isOwn: boolean;
  enableInteractions?: boolean;
  mentionParticipants?: MentionParticipant[];
  groupMentions?: MentionedGroup[];
  onOpenParticipantProfile?: (contactId: string) => void;
  trailing?: ReactNode;
}

export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-1.5 overflow-hidden rounded-md border border-black/10 bg-black/[0.04] text-left dark:border-white/10 dark:bg-black/40">
      <div className="flex items-center justify-between border-b border-black/5 bg-black/[0.03] px-2.5 py-1 text-[11px] font-mono text-gray-500 dark:border-white/5 dark:bg-white/[0.02] dark:text-gray-400">
        <span>{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-500" />
              <span className="text-[10px] text-emerald-500">Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3" />
              <span className="text-[10px]">Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-2.5 font-mono text-xs leading-normal whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Check whether a character is whitespace, punctuation, or start/end boundary. */
function isBoundary(ch: string | undefined): boolean {
  if (!ch) return true;
  return /\s/.test(ch) || /[\p{P}\p{S}]/u.test(ch);
}

interface MatchResult {
  type:
    | "code"
    | "bold"
    | "italic"
    | "strike"
    | "md_link"
    | "mention"
    | "autolink";
  start: number;
  end: number;
  content?: string;
  label?: string;
  href?: string;
  value?: string;
  group?: MentionedGroup;
  participant?: MentionParticipant;
  displayValue?: string;
}

/**
 * Scan for the earliest occurring inline token from fromIndex.
 */
function findNextInlineToken(
  text: string,
  fromIndex: number,
  options: MarkdownRenderOptions,
  participantMap: Map<string, MentionParticipant>,
): MatchResult | null {
  let earliest: MatchResult | null = null;

  const consider = (candidate: MatchResult | null) => {
    if (!candidate) return;
    if (!earliest || candidate.start < earliest.start) {
      earliest = candidate;
    }
  };

  // 1. Inline Code: `...`
  const codeStart = text.indexOf("`", fromIndex);
  if (codeStart !== -1) {
    const codeEnd = text.indexOf("`", codeStart + 1);
    if (codeEnd !== -1 && !text.slice(codeStart + 1, codeEnd).includes("\n")) {
      consider({
        type: "code",
        start: codeStart,
        end: codeEnd + 1,
        content: text.slice(codeStart + 1, codeEnd),
      });
    }
  }

  // 2. Markdown Link: [label](url)
  const linkStart = text.indexOf("[", fromIndex);
  if (linkStart !== -1) {
    const closeBracket = text.indexOf("]", linkStart + 1);
    if (
      closeBracket !== -1 &&
      text[closeBracket + 1] === "(" &&
      !text.slice(linkStart + 1, closeBracket).includes("\n")
    ) {
      const closeParen = text.indexOf(")", closeBracket + 2);
      if (
        closeParen !== -1 &&
        !text.slice(closeBracket + 2, closeParen).includes("\n")
      ) {
        const rawUrl = text.slice(closeBracket + 2, closeParen).trim();
        const safeHref = toSafeHref(rawUrl);
        if (safeHref) {
          consider({
            type: "md_link",
            start: linkStart,
            end: closeParen + 1,
            label: text.slice(linkStart + 1, closeBracket),
            href: safeHref,
          });
        }
      }
    }
  }

  // 3. WhatsApp mentions: @...
  const atIndex = text.indexOf("@", fromIndex);
  if (atIndex !== -1) {
    const mentionRegex = new RegExp(MENTION_PATTERN.source, "g");
    mentionRegex.lastIndex = Math.max(0, fromIndex - 1);
    const m = mentionRegex.exec(text);
    if (m && m.index !== undefined) {
      const prefix = m[1] ?? m[3] ?? "";
      const actualStart = m.index + prefix.length;
      if (actualStart >= fromIndex) {
        const groupJid = m[2];
        const participantId = m[4];
        if (groupJid) {
          const group = options.groupMentions?.find((g) => g.jid === groupJid);
          consider({
            type: "mention",
            start: actualStart,
            end: actualStart + m[0].length - prefix.length,
            group: group ?? { jid: groupJid, subject: groupJid },
            displayValue: `@${group ? group.subject : groupJid}`,
          });
        } else if (participantId) {
          const normalized = digitsOnly(participantId);
          const p = participantMap.get(normalized);
          consider({
            type: "mention",
            start: actualStart,
            end: actualStart + m[0].length - prefix.length,
            participant: p,
            displayValue: p ? `@${displayMentionName(p)}` : `@${participantId}`,
          });
        }
      }
    }
  }

  // Helper for delimiter search (bold **, bold *, strike ~~, strike ~, italic _)
  const findDelimPair = (delim: string, type: "bold" | "italic" | "strike") => {
    let searchPos = fromIndex;
    const dLen = delim.length;
    while (searchPos < text.length) {
      const i = text.indexOf(delim, searchPos);
      if (i === -1) break;

      // Check not preceded by same delim char
      if (
        (i > 0 && text[i - 1] === delim[0]) ||
        (i + dLen < text.length && text[i + dLen] === delim[0])
      ) {
        searchPos = i + dLen;
        continue;
      }

      // Check opener boundary
      const prevChar = i > 0 ? text[i - 1] : undefined;
      const nextChar = i + dLen < text.length ? text[i + dLen] : undefined;
      if (!isBoundary(prevChar) || !nextChar || /\s/.test(nextChar)) {
        searchPos = i + dLen;
        continue;
      }

      // Find closer
      let closerPos = i + dLen;
      let matchedCloser = -1;
      while (closerPos < text.length) {
        const j = text.indexOf(delim, closerPos);
        if (j === -1) break;

        // Check not preceded or succeeded by same delim char
        if (
          (j > 0 && text[j - 1] === delim[0] && dLen === 1) ||
          (j + dLen < text.length && text[j + dLen] === delim[0])
        ) {
          closerPos = j + dLen;
          continue;
        }

        const charBeforeClose = text[j - 1];
        const charAfterClose =
          j + dLen < text.length ? text[j + dLen] : undefined;
        if (!/\s/.test(charBeforeClose) && isBoundary(charAfterClose)) {
          matchedCloser = j;
          break;
        }
        closerPos = j + dLen;
      }

      if (matchedCloser !== -1) {
        consider({
          type,
          start: i,
          end: matchedCloser + dLen,
          content: text.slice(i + dLen, matchedCloser),
        });
        break;
      }

      searchPos = i + dLen;
    }
  };

  // Bold double asterisks **
  findDelimPair("**", "bold");
  // Bold single asterisk * (WhatsApp standard)
  findDelimPair("*", "bold");
  // Strike double tildes ~~
  findDelimPair("~~", "strike");
  // Strike single tilde ~ (WhatsApp standard)
  findDelimPair("~", "strike");
  // Italic underscore _
  findDelimPair("_", "italic");

  // Autolinks
  const linkRegex = new RegExp(LINK_PATTERN.source, "gi");
  linkRegex.lastIndex = fromIndex;
  const linkMatch = linkRegex.exec(text);
  if (
    linkMatch &&
    linkMatch.index !== undefined &&
    linkMatch.index >= fromIndex
  ) {
    const { link } = trimTrailingPunctuation(linkMatch[0]);
    const href = toSafeHref(link);
    if (href) {
      consider({
        type: "autolink",
        start: linkMatch.index,
        end: linkMatch.index + link.length,
        value: link,
        href,
      });
    }
  }

  return earliest;
}

export function parseInline(
  text: string,
  options: MarkdownRenderOptions,
  depth = 0,
): ReactNode[] {
  if (!text) return [];
  if (depth > 6) return [text];

  const participantMap = buildParticipantMap(options.mentionParticipants ?? []);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let keyIndex = 0;

  while (cursor < text.length) {
    const token = findNextInlineToken(text, cursor, options, participantMap);
    if (!token) {
      nodes.push(text.slice(cursor));
      break;
    }

    if (token.start > cursor) {
      nodes.push(text.slice(cursor, token.start));
    }

    const key = `${depth}-${keyIndex++}`;

    switch (token.type) {
      case "code":
        nodes.push(
          <code
            key={key}
            className="rounded px-1.5 py-0.5 font-mono text-[0.875em] bg-black/[0.06] dark:bg-white/[0.08] text-inherit"
          >
            {token.content}
          </code>,
        );
        break;

      case "bold":
        nodes.push(
          <strong key={key} className="font-semibold text-inherit">
            {parseInline(token.content || "", options, depth + 1)}
          </strong>,
        );
        break;

      case "italic":
        nodes.push(
          <em key={key} className="italic text-inherit">
            {parseInline(token.content || "", options, depth + 1)}
          </em>,
        );
        break;

      case "strike":
        nodes.push(
          <del key={key} className="line-through opacity-80 text-inherit">
            {parseInline(token.content || "", options, depth + 1)}
          </del>,
        );
        break;

      case "md_link": {
        const linkClasses = cn(
          "rounded-sm font-medium underline decoration-1 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green",
          options.isOwn
            ? "text-current decoration-current/60 hover:decoration-current"
            : "text-whatsapp-teal-green decoration-whatsapp-teal-green/50 hover:decoration-whatsapp-teal-green dark:text-[#53bdeb] dark:decoration-[#53bdeb]/50",
        );
        nodes.push(
          options.enableInteractions !== false ? (
            <a
              key={key}
              href={token.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={linkClasses}
            >
              {parseInline(token.label || "", options, depth + 1)}
            </a>
          ) : (
            <span key={key} className={linkClasses}>
              {parseInline(token.label || "", options, depth + 1)}
            </span>
          ),
        );
        break;
      }

      case "autolink": {
        const linkClasses = cn(
          "rounded-sm font-medium underline decoration-1 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green",
          options.isOwn
            ? "text-current decoration-current/60 hover:decoration-current"
            : "text-whatsapp-teal-green decoration-whatsapp-teal-green/50 hover:decoration-whatsapp-teal-green dark:text-[#53bdeb] dark:decoration-[#53bdeb]/50",
        );
        nodes.push(
          options.enableInteractions !== false ? (
            <a
              key={key}
              href={token.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={linkClasses}
            >
              {token.value}
            </a>
          ) : (
            <span key={key} className={linkClasses}>
              {token.value}
            </span>
          ),
        );
        break;
      }

      case "mention": {
        if (token.group) {
          nodes.push(
            <span
              key={key}
              className="font-semibold text-whatsapp-teal-green dark:text-[#53bdeb]"
            >
              {token.displayValue}
            </span>,
          );
        } else if (token.participant) {
          const contactId =
            token.participant.contactId || token.participant.jid;
          const mentionClassName = cn(
            "mx-0.5 inline rounded-[0.3rem] px-1 py-0.5 font-semibold",
            options.isOwn
              ? "bg-[#0b6b57]/12 text-[#075e54] dark:bg-[#d9fdd3]/15 dark:text-[#d9fdd3]"
              : "bg-[#00a884]/12 text-[#087f69] dark:bg-[#53bdeb]/15 dark:text-[#53bdeb]",
          );
          nodes.push(
            options.enableInteractions !== false &&
              contactId &&
              options.onOpenParticipantProfile ? (
              <button
                key={key}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  options.onOpenParticipantProfile?.(contactId);
                }}
                aria-label={`Open ${token.displayValue}'s contact info`}
                className={cn(
                  mentionClassName,
                  "cursor-pointer underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green",
                )}
              >
                {token.displayValue}
              </button>
            ) : (
              <span key={key} className={mentionClassName}>
                {token.displayValue}
              </span>
            ),
          );
        } else {
          nodes.push(
            <span key={key} className="font-semibold opacity-90">
              {token.displayValue}
            </span>,
          );
        }
        break;
      }
    }

    cursor = token.end;
  }

  return nodes;
}

export function hasBlockElements(text: string): boolean {
  if (text.includes("```")) return true;
  const lines = text.split("\n");
  for (const line of lines) {
    if (
      /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line) ||
      /^#{1,6}[ \t]+/.test(line) ||
      /^>[ \t]?/.test(line) ||
      /^[ \t]*[-*+][ \t]+/.test(line) ||
      /^[ \t]*\d+\.[ \t]+/.test(line)
    ) {
      return true;
    }
  }
  return false;
}

interface BlockItem {
  type: "code_block" | "heading" | "blockquote" | "list" | "hr" | "paragraph";
  language?: string;
  code?: string;
  level?: number;
  text?: string;
  ordered?: boolean;
  start?: number;
  items?: string[];
}

export function parseBlocks(text: string): BlockItem[] {
  const lines = text.split("\n");
  const blocks: BlockItem[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Fenced Code Block
    const codeMatch = line.match(/^```([a-zA-Z0-9_-]*)[ \t]*$/);
    if (codeMatch) {
      const language = codeMatch[1]?.trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```[ \t]*$/)) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      blocks.push({
        type: "code_block",
        language,
        code: codeLines.join("\n"),
      });
      continue;
    }

    // 2. Horizontal Rule (---, ***, ___)
    if (/^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // 3. Headings (# to ######)
    const headingMatch = line.match(/^(#{1,6})[ \t]+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // 4. Blockquotes (> ...)
    if (/^>[ \t]?(.*)$/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>[ \t]?(.*)$/.test(lines[i])) {
        const m = lines[i].match(/^>[ \t]?(.*)$/);
        quoteLines.push(m ? m[1] : "");
        i++;
      }
      blocks.push({
        type: "blockquote",
        text: quoteLines.join("\n"),
      });
      continue;
    }

    // 5. Unordered List (- or * followed by space)
    if (/^[ \t]*[-*+][ \t]+(.*)$/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[ \t]*[-*+][ \t]+(.*)$/.test(lines[i])) {
        const m = lines[i].match(/^[ \t]*[-*+][ \t]+(.*)$/);
        items.push(m ? m[1] : "");
        i++;
      }
      blocks.push({
        type: "list",
        ordered: false,
        items,
      });
      continue;
    }

    // 6. Ordered List (1. 2. etc.)
    const orderedMatch = line.match(/^[ \t]*(\d+)\.[ \t]+(.*)$/);
    if (orderedMatch) {
      const start = parseInt(orderedMatch[1], 10);
      const items: string[] = [];
      while (i < lines.length && /^[ \t]*\d+\.[ \t]+(.*)$/.test(lines[i])) {
        const m = lines[i].match(/^[ \t]*\d+\.[ \t]+(.*)$/);
        items.push(m ? m[1] : "");
        i++;
      }
      blocks.push({
        type: "list",
        ordered: true,
        start,
        items,
      });
      continue;
    }

    // 7. Normal text (Paragraph)
    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      !lines[i].match(/^```/) &&
      !/^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(lines[i]) &&
      !lines[i].match(/^#{1,6}[ \t]+/) &&
      !lines[i].match(/^>[ \t]?/) &&
      !/^[ \t]*[-*+][ \t]+/.test(lines[i]) &&
      !/^[ \t]*\d+\.[ \t]+/.test(lines[i])
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }
    if (paragraphLines.length > 0) {
      blocks.push({
        type: "paragraph",
        text: paragraphLines.join("\n"),
      });
    }
  }

  return blocks;
}

export function renderMarkdown(
  text: string,
  options: MarkdownRenderOptions,
): ReactNode {
  if (!text) return null;

  // Pure inline text: render without extra block elements to preserve inline trailing layout
  if (!hasBlockElements(text)) {
    return parseInline(text, options);
  }

  const blocks = parseBlocks(text);

  return (
    <div className="space-y-1">
      {blocks.map((block, idx) => {
        const key = `b-${idx}`;
        switch (block.type) {
          case "code_block":
            return (
              <CodeBlock
                key={key}
                code={block.code || ""}
                language={block.language}
              />
            );

          case "hr":
            return (
              <hr
                key={key}
                className="my-2 border-0 border-t border-black/15 dark:border-white/15"
              />
            );

          case "heading": {
            const headingClasses =
              block.level === 1
                ? "my-1 text-base font-bold text-inherit"
                : block.level === 2
                  ? "my-0.5 text-[15px] font-bold text-inherit"
                  : "my-0.5 text-sm font-semibold text-inherit";
            return (
              <div key={key} className={headingClasses}>
                {parseInline(block.text || "", options)}
              </div>
            );
          }

          case "blockquote":
            return (
              <blockquote
                key={key}
                className={cn(
                  "my-1 border-l-[3px] pl-2.5 text-inherit opacity-90 italic",
                  options.isOwn
                    ? "border-current/40"
                    : "border-whatsapp-teal-green/60 dark:border-[#53bdeb]/60",
                )}
              >
                {parseInline(block.text || "", options)}
              </blockquote>
            );

          case "list":
            if (block.ordered) {
              return (
                <ol
                  key={key}
                  start={block.start}
                  className="my-1 list-decimal space-y-0.5 pl-5 text-inherit"
                >
                  {block.items?.map((item, itemIdx) => (
                    <li key={`${key}-${itemIdx}`}>
                      {parseInline(item, options)}
                    </li>
                  ))}
                </ol>
              );
            }
            return (
              <ul
                key={key}
                className="my-1 list-disc space-y-0.5 pl-5 text-inherit"
              >
                {block.items?.map((item, itemIdx) => (
                  <li key={`${key}-${itemIdx}`}>
                    {parseInline(item, options)}
                  </li>
                ))}
              </ul>
            );

          case "paragraph":
            return (
              <div key={key} className="leading-normal">
                {parseInline(block.text || "", options)}
              </div>
            );
        }
      })}
    </div>
  );
}
