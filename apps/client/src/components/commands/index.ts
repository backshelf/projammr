import { assertUniqueIds } from "@/components/commands/define";
import { COMMAND_BAR_COMMANDS } from "@/components/commands/command-bar";
import { COMMENTS_COMMANDS } from "@/components/commands/comments";
import { DIALOG_COMMANDS } from "@/components/commands/dialogs";
import { ENTITY_COMMANDS } from "@/components/commands/entity";
import { GRID_COMMANDS } from "@/components/commands/grid";
import { HISTORY_COMMANDS } from "@/components/commands/history";
import { LAB_COMMANDS } from "@/components/commands/lab";
import { NAVIGATION_COMMANDS } from "@/components/commands/navigation";
import { NOTEBOOK_COMMANDS } from "@/components/commands/notebook";
import { PALETTE_COMMANDS } from "@/components/commands/palette";
import { PEEK_COMMANDS } from "@/components/commands/peek";
import { PLAYER_COMMANDS } from "@/components/commands/player";
import { QUEUE_COMMANDS } from "@/components/commands/queue";
import { SETTINGS_COMMANDS } from "@/components/commands/settings";
import { SIDEBAR_COMMANDS } from "@/components/commands/sidebar";
import { TABLE_COMMANDS } from "@/components/commands/tables";
import { TRACK_COMMANDS } from "@/components/commands/tracks";
import type { Command } from "@/components/commands/types";
import { VIEW_COMMANDS } from "@/components/commands/views";

/** Every command the signed-in app declares, one area per line. */
export const COMMANDS: readonly Command[] = [
  ...COMMAND_BAR_COMMANDS,
  ...COMMENTS_COMMANDS,
  ...DIALOG_COMMANDS,
  ...ENTITY_COMMANDS,
  ...GRID_COMMANDS,
  ...HISTORY_COMMANDS,
  ...LAB_COMMANDS,
  ...NAVIGATION_COMMANDS,
  ...NOTEBOOK_COMMANDS,
  ...PALETTE_COMMANDS,
  ...PEEK_COMMANDS,
  ...PLAYER_COMMANDS,
  ...QUEUE_COMMANDS,
  ...SETTINGS_COMMANDS,
  ...SIDEBAR_COMMANDS,
  ...TABLE_COMMANDS,
  ...TRACK_COMMANDS,
  ...VIEW_COMMANDS,
];

assertUniqueIds(COMMANDS);
