"use client";

import { useEffect, useRef, useState } from "react";
import {
  useAudibleSide,
  useCurrentTrack,
  useIsPlaying,
} from "@/components/music-player/player-hooks";
import {
  playbackState,
  type PlaybackOwner,
} from "@/components/art/playing-light";
import { useLoudnessFrames } from "@/components/loudness/use-loudness-frames";
import { follow, roomEnergy } from "@/lib/meter-ballistics";
import { useVisualsPolicy } from "@/lib/policies/provider";
import { useReducedMotion } from "@workspace/ui/lib/motion";

/** The art answers a hit within a frame or two and exhales over half a second. */
const ART = { attackMs: 90, releaseMs: 620 };
/** The haze lower on the page follows the passage, not the beat. */
const HAZE = { attackMs: 900, releaseMs: 2600 };

/**
 * How far the light travels with the music. The resting opacity is the
 * room's playing level from globals.css; the swing goes above and below it so
 * a quiet passage dims the room as much as a chorus lifts it.
 */
const SWING = {
  light: { rest: 0.88, range: 0.24, haze: 0.55 },
  dark: { rest: 0.78, range: 0.42, haze: 0.45 },
};

/**
 * Marks the {@link ArtProvider} container with `data-playing` while this
 * page's own record is loaded and playing, so the masthead art can brighten
 * for it in `globals.css`. It renders a hidden marker and reaches up to its
 * DOM parent, so the provider needs no ref threaded through the page's
 * server components.
 *
 * While it plays, the room also breathes with it: the live loudness of the
 * audible source drives the art's tone layer opacity (level plus a lift on
 * each hit) and, far slower, the page wash's deep lobe. The breath writes the
 * tone layer rather than the art frame above it, which is Motion's for the
 * entrance; the two opacities multiply, so a receding light still breathes.
 * Only those two elements' own inline `opacity` is written — never a custom
 * property, which the art's layers inherit and so re-rasterize every frame
 * for, and never a variable on the container, which would restyle the whole
 * page — so both changes stay on the compositor. When playback stops the
 * inline styles are removed and the stylesheet's transition carries the art
 * back to rest. Reduced motion, or a visuals policy with the breath off,
 * keeps the static brightening only.
 */
export function PlayingLight({ owner }: { owner: PlaybackOwner }) {
  const current = useCurrentTrack();
  const isPlaying = useIsPlaying();
  const audible = useAudibleSide();
  const reduced = useReducedMotion();
  const { artBreathes } = useVisualsPolicy();
  const state = playbackState(current, isPlaying, owner);
  const markerRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const container = markerRef.current?.parentElement;
    if (!container) return;
    if (state === "playing") container.setAttribute("data-playing", "");
    else container.removeAttribute("data-playing");
    return () => container.removeAttribute("data-playing");
  }, [state]);

  // Gate the breathing rAF loop when the masthead art has scrolled off-screen.
  useEffect(() => {
    const container = markerRef.current?.parentElement;
    const artTarget =
      container?.querySelector<HTMLElement>(".masthead__art") ?? container;
    if (!artTarget || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry) setVisible(entry.isIntersecting);
    });
    observer.observe(artTarget);
    return () => observer.disconnect();
  }, []);

  const breathing = state === "playing" && !reduced && artBreathes && visible;
  // Starts mid-swing, at the rest level, so the breath begins where the
  // stylesheet's playing brightness already is.
  const levelsRef = useRef({ art: 0.5, haze: 0.5 });
  // The two elements the breath writes, and the theme's swing curve, looked up
  // outside the per-frame callback rather than traversing the DOM at 60fps.
  const targetsRef = useRef<{
    art: HTMLElement | null;
    haze: HTMLElement | null;
  }>({ art: null, haze: null });
  const swingRef = useRef(SWING.light);

  useEffect(() => {
    const container = markerRef.current?.parentElement;
    if (!container) return;
    const syncSwing = () => {
      swingRef.current = container.closest(".dark") ? SWING.dark : SWING.light;
    };
    syncSwing();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(syncSwing);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!breathing) return;
    const container = markerRef.current?.parentElement;
    if (!container) return;
    const art = container.querySelector<HTMLElement>(".masthead__tone");
    const haze = container.querySelector<HTMLElement>(".wash__lobe--deep");
    targetsRef.current = { art, haze };
    // Set the smoothing transitions once per active breathing window instead
    // of writing style properties every frame.
    art?.style.setProperty("transition", "opacity 200ms linear");
    // The lobe keeps this transition after the breath stops, so it eases back
    // to full as slowly as it moved.
    haze?.style.setProperty("transition", "opacity 1.2s linear");
  }, [breathing]);

  useLoudnessFrames(breathing, (sides, dt, active) => {
    const container = markerRef.current?.parentElement;
    if (!container) return false;
    const targets = targetsRef.current;
    if (
      !targets.art?.isConnected ||
      (targets.haze && !targets.haze.isConnected)
    ) {
      targets.art = container.querySelector<HTMLElement>(".masthead__tone");
      targets.haze = container.querySelector<HTMLElement>(".wash__lobe--deep");
      if (active) {
        targets.art?.style.setProperty("transition", "opacity 200ms linear");
        targets.haze?.style.setProperty("transition", "opacity 1.2s linear");
      }
    }
    const { art, haze } = targets;
    if (!art) return false;

    if (!active) {
      art.style.removeProperty("opacity");
      art.style.removeProperty("transition");
      haze?.style.removeProperty("opacity");
      levelsRef.current = { art: 0.5, haze: 0.5 };
      return false;
    }

    const frame = sides[audible];
    if (!frame) return;
    const energy = roomEnergy(frame.momentary, frame.shortTerm);
    const l = levelsRef.current;
    l.art = follow(l.art, energy, dt, ART);
    l.haze = follow(l.haze, energy, dt, HAZE);

    const swing = swingRef.current;
    const opacity = swing.rest + (l.art - 0.5) * swing.range;
    art.style.setProperty("opacity", opacity.toFixed(3));
    haze?.style.setProperty(
      "opacity",
      (1 - swing.haze + l.haze * swing.haze).toFixed(3)
    );
  });

  return <span ref={markerRef} aria-hidden style={{ display: "none" }} />;
}
