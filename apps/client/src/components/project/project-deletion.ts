/**
 * What deleting a project takes with it, shared by the delete dialog and the
 * settings Danger zone pane so the two never drift. Every collection, track,
 * session, comment and attachment cascades from the project row; so does
 * everyone's membership. A member's own notebook notes are never deleted —
 * only their link to a track, if any, is cleared.
 *
 * A plain module rather than an export of the dialog's client component, so
 * the server-rendered Danger zone pane can call it.
 */
export const projectDeletionLossSentence = (projectName: string) =>
  `Deleting ${projectName} permanently removes every collection, track and session in it, along with their attachments and comments. Everyone loses access, and this cannot be undone.`;
