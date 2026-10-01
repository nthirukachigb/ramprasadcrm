"use client";

import { useEffect, useState } from "react";
import { Bell as BellIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listNotifications,
  markNotificationRead,
  type NotificationItem,
} from "@/lib/actions/tasks";
import { formatDate } from "@/lib/format";

const LABELS: Record<string, string> = {
  commitment_changed: "A commitment was changed",
  commitment_withdrawn: "A commitment was withdrawn",
};

export function Bell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  async function load() {
    const result = await listNotifications();
    setItems(result.items);
    setUnread(result.unread);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await listNotifications();
      if (!active) return;
      setItems(result.items);
      setUnread(result.unread);
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <BellIcon className="size-4" aria-hidden="true" />
          {unread > 0 ? (
            <span className="bg-destructive text-destructive-foreground absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full text-[10px]">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="text-muted-foreground p-3 text-sm">
            No notifications — you are up to date.
          </p>
        ) : (
          items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              className="flex flex-col items-start gap-0.5"
              onSelect={() => {
                if (!item.is_read) {
                  void markNotificationRead({ id: item.id }).then(load);
                }
              }}
            >
              <span className={item.is_read ? "" : "font-medium"}>
                {LABELS[item.notification_type] ?? item.notification_type}
              </span>
              <span className="text-muted-foreground text-xs">
                {formatDate(item.created_at)}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
