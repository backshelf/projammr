"use client";
import { signOut } from "@/lib/sign-out";
import { DropdownMenuItem } from "@workspace/ui/components/dropdown-menu";

export default function SignOutDropdownMenuItem() {
  return (
    <DropdownMenuItem variant={"destructive"} onClick={signOut}>
      Sign Out
    </DropdownMenuItem>
  );
}
