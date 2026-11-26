import { entityModule } from "@/entities";
import { routeDeclaration } from "@/entities/routes";
import type { EntityNouns } from "@/entities/types";
import type { ParsedRoute } from "@/lib/route-parser";

/** Where the "Back to project" link in every no-kind and no-list-route case goes. */
const PROJECT_ROOT: ParsedRoute = { kind: "project" };
const BACK_TO_PROJECT: RouteCopy["link"] = {
  label: "Back to project",
  route: PROJECT_ROOT,
};

const capitalize = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1);

/** What a not-found or an error state says, and the one link it offers below its actions. */
export type RouteCopy = {
  title: string;
  body?: string;
  link: { label: string; route: ParsedRoute };
};

/**
 * The nouns and list route a route reads its copy from, or `null` for a
 * `not-found` route and for a route whose declaration names no entity —
 * both read as a page rather than a kind.
 */
const entityWordsFor = (
  route: ParsedRoute
): {
  nouns: EntityNouns;
  listRoute: ParsedRoute | null;
  shows: "row" | "list";
} | null => {
  if (route.kind === "not-found") return null;

  const { entity, shows } = routeDeclaration(route.kind);
  if (!entity || !shows) return null;

  const { nouns, listRoute } = entityModule(entity);
  return { nouns, listRoute, shows };
};

/** The not-found state for `route`: a kind's own copy, or the page fallback. */
export function notFoundCopy(route: ParsedRoute): RouteCopy {
  const words = entityWordsFor(route);
  if (!words) {
    return {
      title: "Page not found",
      body: "This page doesn't exist, or you don't have access to it.",
      link: BACK_TO_PROJECT,
    };
  }

  const { singular, plural } = words.nouns;
  return {
    title: `${capitalize(singular)} not found`,
    body: `This ${singular} doesn't exist, or you don't have access to it.`,
    link: words.listRoute
      ? { label: `All ${plural}`, route: words.listRoute }
      : BACK_TO_PROJECT,
  };
}

/** The error state for `route`: a kind's own copy, or the page fallback. */
export function errorCopy(route: ParsedRoute): RouteCopy {
  const words = entityWordsFor(route);
  if (!words) {
    return { title: "Couldn't load this page", link: BACK_TO_PROJECT };
  }

  const { singular, plural } = words.nouns;
  const title =
    words.shows === "list"
      ? `Couldn't load ${plural}`
      : `Couldn't load this ${singular}`;
  return { title, link: BACK_TO_PROJECT };
}
