import "server-only";
import { getCollection } from "@/actions/collections";
import { getCustomFields } from "@/actions/custom-fields";
import { getInstance } from "@/actions/instance";
import { getMe, getMyProjects } from "@/actions/me";
import { getMyNotes, getNote } from "@/actions/notes";
import { getCollectionSummaries, getProject } from "@/actions/projects";
import { getRepo } from "@/actions/repos";
import { getSession, getSessionSummaries } from "@/actions/sessions";
import { getTrack, getTrackSummaries } from "@/actions/tracks";
import { getCachedSession, sessionUser } from "@/lib/session";
import { isActionError } from "@workspace/api/lib/action-result";
import type {
  CustomField,
  CustomFieldKind,
  MyProject,
} from "@workspace/api/api";
import { cookies } from "next/headers";
import { cache } from "react";

/*
 * Request-scoped reads.
 *
 * Server actions cannot be wrapped in `cache` themselves, so the reads that
 * several components on one page all need go through these. Without them the
 * sidebar, the layout, `generateMetadata` and the page each pay for the same
 * fetch.
 */

/** `getMyProjects` reports a failed read; the app shell has nothing useful to
 *  do with that beyond rendering as if the caller belonged to no projects. */
export const cachedMyProjects = cache(async (): Promise<MyProject[]> => {
  const result = await getMyProjects();
  return isActionError(result) ? [] : result;
});

export const cachedMe = cache(getMe);

/** The instance's public facts; a signed-out page's settings and its sign-in
 *  card share this one read per request. */
export const cachedInstance = cache(getInstance);

/** Whether the signed-in caller administers this instance — the settings
 *  hub's Instance section and the palette's settings share this one read per
 *  request.
 *  Derived from `cachedMe()`'s own copy of the caller's role rather than a
 *  separate probe, so a failed `/me` reads as "not an admin" rather than
 *  throwing. */
export const cachedIsInstanceAdmin = cache(async () => {
  const me = await cachedMe();
  return isActionError(me) ? false : me.instanceRole === "admin";
});

export const cachedProject = cache(getProject);

export const cachedTrack = cache(getTrack);

export const cachedCollection = cache(getCollection);

export const cachedSession = cache(getSession);

export const cachedRepo = cache(getRepo);

export const cachedCollectionSummaries = cache(getCollectionSummaries);

/**
 * The project's custom fields of `kind`, or every kind's when it is absent:
 * the table, the rail, the create form and the activity feed of one page all
 * read them. A kind with no custom fields (`null`) and a failed read both come
 * back empty, which draws every surface as it is without them.
 */
export const cachedCustomFields = cache(
  async (
    projectId: number,
    kind?: CustomFieldKind | null
  ): Promise<CustomField[]> => {
    if (kind === null) return [];
    const result = await getCustomFields(projectId, kind);
    return isActionError(result) ? [] : result;
  }
);

export const cachedTrackSummaries = cache(getTrackSummaries);

export const cachedSessionSummaries = cache(getSessionSummaries);

export const cachedMyNotes = cache(getMyNotes);

export const cachedNote = cache(getNote);

/**
 * What every piece of app shell needs: who is signed in, the projects they can
 * switch to, and which of those is current. The sidebar and the phone's top
 * strip both render from this one request-cached read.
 */
export const cachedShellData = cache(async () => {
  const [session, projects, currentProjectId] = await Promise.all([
    getCachedSession(),
    cachedMyProjects(),
    currentProjectIdCookie(),
  ]);

  return {
    user: sessionUser(session),
    projects,
    currentProject: projects.find((project) => project.id === currentProjectId),
  };
});

export async function currentProjectIdCookie() {
  const cookieStore = await cookies();
  return Number(cookieStore.get("currentProject")?.value ?? 0);
}
