"use client";

import { useRef, type PropsWithChildren } from "react";
import type { Artwork } from "@workspace/api/api";
import { artVarsFromArtwork } from "@/lib/art";
import { CanvasRootProvider } from "@workspace/ui/components/layout/scroll-root";
import { useScrollRestoration } from "@workspace/ui/hooks/use-scroll-restoration";
import {
  ArrivalRoot,
  useArrivalKind,
} from "@workspace/ui/components/motion/arrival";
import { MastheadArt, MastheadScrim } from "@/components/art/MastheadArt";
import { PageWash } from "@/components/art/PageWash";
import { PlayingLight } from "@/components/art/PlayingLight";
import type { PlaybackOwner } from "@/components/art/playing-light";
import { MastheadArtMorph } from "@/components/motion/ArtMorph";
import { CanvasScrollProvider } from "@/components/motion/canvas-scroll";

/**
 * Wraps a page subtree and exposes the resolved artwork accent as
 * `--art`, `--art-glow` and `--art-image`. `artwork` is the cover the API
 * resolved for the entity; passing null renders the grayscale fallback.
 *
 * The page-atmosphere wash ({@link PageWash}) is rendered here, inside the
 * element that carries the accent, so it reads the same variables.
 *
 * This wrapper is also the page's {@link ArrivalRoot}: the art, the wash and
 * every part of the masthead below it take their entrance from it. It is the
 * element the page scrolls in, so it publishes itself as the {@link CanvasRootProvider}
 * the content below it watches itself travel through, and its offset through
 * {@link CanvasScrollProvider}, which the masthead recedes against. That
 * offset is carried across a traverse or a reload by
 * {@link useScrollRestoration}.
 *
 * `playing`, when given, marks this page's own playback owner (a track or a
 * collection); {@link PlayingLight} watches the player for it and flags the
 * container with `data-playing` while it is loaded and playing, which is what
 * brightens the masthead art in `globals.css`.
 */
export function ArtProvider({
  artwork,
  playing,
  className,
  children,
}: PropsWithChildren<{
  artwork: Artwork | null;
  playing?: PlaybackOwner;
  className?: string;
}>) {
  const vars = artVarsFromArtwork(artwork);
  const canvasRef = useRef<HTMLDivElement>(null);
  useScrollRestoration(canvasRef);

  return (
    <ArrivalRoot
      kind={useArrivalKind()}
      ref={canvasRef}
      className={className}
      style={vars}
    >
      <CanvasRootProvider containerRef={canvasRef}>
        <CanvasScrollProvider>
          {playing && <PlayingLight owner={playing} />}
          <PageWash />
          <MastheadArtMorph>
            <MastheadArt />
          </MastheadArtMorph>
          <MastheadScrim />
          {children}
        </CanvasScrollProvider>
      </CanvasRootProvider>
    </ArrivalRoot>
  );
}
