import { join, resolve } from "node:path";
import type { MemberRole } from "@workspace/api/lib/enums";
import type {
  Cover,
  DemoCatalogue,
  DemoProject,
  DemoTrack,
  DemoVersion,
} from "./model";

/**
 * The statuses every instance starts with (the `seed-statuses` migration).
 * A track or collection may name one of these instead of a project status.
 */
export const GLOBAL_STATUSES = ["To Do", "In Progress", "Complete"] as const;

export const REPO_ROOT = resolve(import.meta.dir, "../../..");

export const coverPath = (cover: Cover) =>
  join(REPO_ROOT, "fixtures/covers", `${cover}.jpg`);

export interface VersionRef {
  project: DemoProject;
  track: DemoTrack;
  version: DemoVersion;
  index: number;
}

export function* versionsOf(catalogue: DemoCatalogue): Generator<VersionRef> {
  for (const project of catalogue.projects) {
    for (const track of project.tracks) {
      for (const [index, version] of track.versions.entries()) {
        yield { project, track, version, index };
      }
    }
  }
}

/** The version a track plays by default: `primary`, or the last one uploaded. */
export const primaryIndex = (track: DemoTrack) =>
  track.primary ?? track.versions.length - 1;

export function roleIn(
  project: DemoProject,
  account: string
): MemberRole | undefined {
  if (project.owner === account) return "owner";
  return project.members.find((m) => m.account === account)?.role;
}

const WRITERS: readonly MemberRole[] = ["owner", "admin", "editor"];

/** Whether the account may write in the project: comment, edit, link lyrics. */
export const canWrite = (project: DemoProject, account: string) => {
  const role = roleIn(project, account);
  return role !== undefined && WRITERS.includes(role);
};

export const findTrack = (project: DemoProject, key: string) =>
  project.tracks.find((t) => t.key === key);

export const findCollection = (project: DemoProject, key: string) =>
  project.collections.find((c) => c.key === key);
