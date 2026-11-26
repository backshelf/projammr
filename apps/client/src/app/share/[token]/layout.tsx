import { MusicPlayerProvider } from "@/components/music-player/MusicPlayerProvider";
import { DEFAULT_PLAYER_INITIAL } from "@/components/music-player/player-initial";

/**
 * A share link is its own surface: whoever opens it — a guest on an anonymous
 * session or a member of the project — sees the shared audio and nothing of
 * the app around it. The player store is mounted here rather than inherited,
 * because the signed-in shell that usually owns one is deliberately absent,
 * and it plays by the default policies for everyone, member or guest, at the
 * default normalise target: a guest cannot read a project's settings.
 */
export default function ShareLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <MusicPlayerProvider
      initial={DEFAULT_PLAYER_INITIAL}
      perProjectTarget={false}
    >
      <main className={"min-h-0 min-w-0 flex-1 overflow-hidden"}>
        {children}
      </main>
    </MusicPlayerProvider>
  );
}
