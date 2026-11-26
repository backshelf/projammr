import { defineCommands, defineScope } from "@/components/commands/define";

/** What a comment composer's push attaches: submitting the text it holds. */
export type ComposeSurface = {
  send: () => void;
};

/** Pushed while focus is inside a comment composer, root or reply alike. */
export const COMPOSE_SCOPE = defineScope<ComposeSurface>("compose");

/** The composer's send key, answering even while its own textarea has focus. */
export const COMMENTS_COMMANDS = defineCommands(COMPOSE_SCOPE, [
  {
    id: "send-comment",
    label: "Send comment",
    group: "General",
    keys: ["mod+Enter"],
    allowInInput: true,
    run: (ctx) => ctx.surface.send(),
  },
]);
