import { db } from "../db/index.js";
import {
  defaultLevelId,
  seedPriorityLevels,
} from "../db/queries/priority-levels.js";

/**
 * Gives a project a test inserted straight into `projects` the scale
 * `createProject` seeds, and answers its default level: every track,
 * collection and session the test then inserts by hand has to name one.
 */
export async function seedScale(projectId: number): Promise<number> {
  await seedPriorityLevels(db, projectId);
  return defaultLevelId(projectId);
}
