import { useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useArchiveContact } from "@/hooks/useContact";
import { useTranslation } from "react-i18next";

interface ArchiveStatusSectionProps {
  contact: {
    id: string;
    displayName: string;
    isArchived?: boolean;
    conversationId?: string | null;
  };
}

/**
 * Archive status section - archive/unarchive individual or group chats
 */
export function ArchiveStatusSection({ contact }: ArchiveStatusSectionProps) {
  const { t } = useTranslation();
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const archiveContact = useArchiveContact();

  const isArchived = Boolean(contact.isArchived);

  const handleToggle = () => {
    if (!isArchived) {
      setShowConfirmDialog(true);
    } else {
      archiveContact.mutate({
        contactId: contact.id,
        conversationId: contact.conversationId ?? undefined,
        isArchived: false,
      });
    }
  };

  const handleConfirmArchive = async () => {
    await archiveContact.mutateAsync({
      contactId: contact.id,
      conversationId: contact.conversationId ?? undefined,
      isArchived: true,
    });
    setShowConfirmDialog(false);
  };

  return (
    <>
      <RightPanelSection title={t("chat.archiveStatus", "Archive Status")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isArchived ? (
              <Archive className="h-4 w-4 text-whatsapp-teal-green" />
            ) : (
              <ArchiveRestore className="h-4 w-4 text-gray-400" />
            )}
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-dark-text-primary">
                {isArchived
                  ? t("chat.chatArchived", "Chat Archived")
                  : t("chat.chatActive", "Active Inbox")}
              </p>
              <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                {isArchived
                  ? t(
                      "chat.archivedHint",
                      "This chat is stored in your archived chats",
                    )
                  : t(
                      "chat.activeHint",
                      "This chat appears in your active inbox",
                    )}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleToggle}
            disabled={archiveContact.isPending}
            className={
              isArchived
                ? "text-whatsapp-teal-green hover:bg-whatsapp-teal-green/10"
                : "text-gray-700 dark:text-dark-text-primary hover:bg-gray-100"
            }
          >
            {isArchived ? (
              <>
                <ArchiveRestore className="mr-1 h-4 w-4" />
                {t("chat.unarchive", "Unarchive")}
              </>
            ) : (
              <>
                <Archive className="mr-1 h-4 w-4" />
                {t("chat.archive", "Archive")}
              </>
            )}
          </Button>
        </div>
      </RightPanelSection>

      <ConfirmationDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        title={t("chat.archiveChat", "Archive Chat")}
        description={t("chat.archiveConfirm", {
          defaultValue:
            "Are you sure you want to archive {{name}}? Archived chats stay in the archived section until unarchived.",
          name: contact.displayName,
        })}
        confirmText={t("chat.archive", "Archive")}
        cancelText={t("common.cancel", "Cancel")}
        isLoading={archiveContact.isPending}
        onConfirm={handleConfirmArchive}
      />
    </>
  );
}
