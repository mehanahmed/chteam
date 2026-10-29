import { useQuery } from "@tanstack/react-query";
import {
  getChannelConversation,
  getChannelConversations,
  getChannelMessages,
} from "@/lib/api/channel-conversations";
import { ApiRequestError } from "@/lib/api/client";
import { queryKeys } from "./query-keys";

const EMPTY_TAG_IDS: readonly string[] = [];

export function useChannelConversations(
  limit = 50,
  tagIds: readonly string[] = EMPTY_TAG_IDS,
  archived?: boolean,
) {
  const stableTagIds = tagIds.length === 0 ? EMPTY_TAG_IDS : tagIds;
  return useQuery({
    queryKey: [...queryKeys.channelConversations.lists(), { limit, tagIds: stableTagIds, archived }],
    queryFn: async () => {
      try {
        return await getChannelConversations({ limit, tagIds, archived });
      } catch (error) {
        if (error instanceof ApiRequestError && error.statusCode === 404) {
          return [];
        }
        throw error;
      }
    },
    staleTime: 30_000,
  });
}

export function useChannelConversation(
  conversationId: string | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.channelConversations.detail(conversationId ?? ""),
    queryFn: async () => {
      try {
        return await getChannelConversation(conversationId!);
      } catch (error) {
        if (error instanceof ApiRequestError && error.statusCode === 404) {
          return null;
        }
        throw error;
      }
    },
    enabled: Boolean(conversationId),
    staleTime: 30_000,
  });
}

export function useChannelMessages(
  conversationId: string | null | undefined,
  options: { limit?: number; cursor?: string } = {},
) {
  const { limit = 50, cursor } = options;
  return useQuery({
    queryKey: queryKeys.channelMessages.list({
      conversationId: conversationId ?? "",
      limit,
      cursor,
    }),
    queryFn: () => getChannelMessages(conversationId!, { limit, cursor }),
    enabled: Boolean(conversationId),
    staleTime: 30_000,
  });
}
