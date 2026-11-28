"use client";

import {
  BottomSheet,
  SHEET_ROW,
  SheetCancelRow,
} from "@/components/dock/BottomSheet";
import { AppLink } from "@/components/navigation/AppLink";
import { SETTINGS_HREF } from "@/lib/settings/href";
import { signOut } from "@/lib/sign-out";
import { mediaProxyUrl } from "@/lib/utils";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { SheetClose } from "@workspace/ui/components/sheet";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { IconUserCircle } from "@tabler/icons-react";
import { THEMES } from "@workspace/settings/appearance";
import { useTheme } from "@/components/theme/AppThemeProvider";

export function AccountSheet({
  user,
}: {
  user: { name: string; email: string; image?: string | null };
}) {
  const { theme, setTheme } = useTheme();

  return (
    <BottomSheet
      title={"Account"}
      trigger={
        <button
          type={"button"}
          className={"flex size-11 shrink-0 items-center justify-center"}
          aria-label={"Account"}
        >
          <Avatar className={"size-8"}>
            <AvatarImage src={mediaProxyUrl(user.image)} alt={""} />
            <AvatarFallback>
              <IconUserCircle />
            </AvatarFallback>
          </Avatar>
        </button>
      }
    >
      <div className={cn(SHEET_ROW, "gap-3 py-2")}>
        <Avatar className={"size-8"}>
          <AvatarImage src={mediaProxyUrl(user.image)} alt={""} />
          <AvatarFallback>
            <IconUserCircle />
          </AvatarFallback>
        </Avatar>
        <div className={"flex min-w-0 flex-col"}>
          <span className={"truncate"}>{user.name}</span>
          <span className={"truncate text-micro text-ink-soft"}>
            {user.email}
          </span>
        </div>
      </div>
      <SheetClose asChild nativeButton={false}>
        <AppLink href={"/profile"} className={SHEET_ROW}>
          Profile
        </AppLink>
      </SheetClose>
      <SheetClose asChild nativeButton={false}>
        <AppLink href={SETTINGS_HREF} className={SHEET_ROW}>
          Settings
        </AppLink>
      </SheetClose>
      <div className={cn(SHEET_ROW, "justify-between")}>
        <span>Theme</span>
        <span className={"flex items-center gap-2"}>
          {THEMES.map((option) => (
            <button
              key={option}
              type={"button"}
              onClick={() => setTheme(option)}
              aria-pressed={theme === option}
              className={cn(
                LABEL,
                "min-h-11 min-w-11 rounded-sm border border-rule px-3",
                theme === option ? "border-art text-ink" : "text-ink-soft"
              )}
            >
              {option}
            </button>
          ))}
        </span>
      </div>
      <button
        type={"button"}
        onClick={signOut}
        className={cn(SHEET_ROW, "text-destructive")}
      >
        Sign out
      </button>
      <SheetCancelRow />
    </BottomSheet>
  );
}
