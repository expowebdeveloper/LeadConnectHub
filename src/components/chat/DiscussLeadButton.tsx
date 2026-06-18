import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus } from "lucide-react";
import { ShareToChatDialog } from "./ShareToChatDialog";

/**
 * Drop into any lead profile page to give agents a fast way to discuss the
 * lead in Chat Vault or share it to an existing conversation.
 */
export function DiscussLeadButton({
  leadId,
  leadName,
  variant = "outline",
  size = "sm",
}: {
  leadId: string;
  leadName?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <MessageSquarePlus className="mr-1.5 h-4 w-4" />
        Discuss in Chat
      </Button>
      <ShareToChatDialog
        open={open}
        onClose={() => setOpen(false)}
        leadId={leadId}
        leadName={leadName}
      />
    </>
  );
}
