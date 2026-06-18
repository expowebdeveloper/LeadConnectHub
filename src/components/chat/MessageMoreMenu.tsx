import { useServerFn } from "@tanstack/react-start";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Pin, Check, Link2, FileText, ExternalLink, Trash2, Pencil, Copy } from "lucide-react";
import { pinMessageToLeadTimeline, addMessageNoteToLead } from "@/lib/chat-crm.functions";
import { toast } from "sonner";

export function MessageMoreMenu({
  messageId,
  messageBody,
  mine,
  linkedLeadId,
  onCreateTask,
  onEdit,
  onDelete,
  onOpenLead,
}: {
  messageId: string;
  messageBody?: string | null;
  mine: boolean;
  linkedLeadId?: string | null;
  onCreateTask: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onOpenLead?: (leadId: string) => void;
}) {
  const pinFn = useServerFn(pinMessageToLeadTimeline);
  const noteFn = useServerFn(addMessageNoteToLead);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="More">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={onCreateTask}>
          <Check className="mr-2 h-4 w-4 text-chat-accent" /> Create task from message
        </DropdownMenuItem>
        {linkedLeadId && (
          <>
            <DropdownMenuItem
              onSelect={async () => {
                try {
                  await pinFn({ data: { messageId, leadId: linkedLeadId } });
                  toast.success("Pinned to lead timeline");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
            >
              <Pin className="mr-2 h-4 w-4 text-chat-accent" /> Pin to lead timeline
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                try {
                  await noteFn({ data: { messageId, leadId: linkedLeadId } });
                  toast.success("Added to lead as note");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
            >
              <FileText className="mr-2 h-4 w-4 text-chat-accent" /> Add note to lead
            </DropdownMenuItem>
            {onOpenLead && (
              <DropdownMenuItem onSelect={() => onOpenLead(linkedLeadId)}>
                <ExternalLink className="mr-2 h-4 w-4" /> Open related lead
              </DropdownMenuItem>
            )}
          </>
        )}
        {!linkedLeadId && (
          <DropdownMenuItem disabled>
            <Link2 className="mr-2 h-4 w-4 opacity-50" /> Link lead first to enable
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {messageBody && (
          <DropdownMenuItem
            onSelect={() => {
              navigator.clipboard.writeText(messageBody);
              toast.success("Copied");
            }}
          >
            <Copy className="mr-2 h-4 w-4" /> Copy text
          </DropdownMenuItem>
        )}
        {mine && onEdit && (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </DropdownMenuItem>
        )}
        {mine && onDelete && (
          <DropdownMenuItem onSelect={onDelete} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}