"use client";

import { useState } from "react";
import { Dialog } from "radix-ui";
import { Menu, X } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { SidebarNav } from "./sidebar";
import { Brand } from "./brand";

/** Below the large breakpoint the sidebar becomes a drawer. */
export function MobileNav({ visible }: { visible: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <IconButton label="Open navigation" className="lg:hidden">
          <Menu aria-hidden />
        </IconButton>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="bg-overlay fixed inset-0 z-40" />
        <Dialog.Content className="bg-sidebar fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto shadow-lg">
          <div className="h-topbar flex items-center justify-between px-3">
            <Brand />
            <Dialog.Close asChild>
              <IconButton label="Close navigation">
                <X aria-hidden />
              </IconButton>
            </Dialog.Close>
          </div>
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Description className="sr-only">Main sections of HMBL OS</Dialog.Description>
          <SidebarNav visible={visible} onNavigate={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
