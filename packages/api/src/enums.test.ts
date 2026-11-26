import { describe, expect, it } from "bun:test";
import { REGISTRATION_MODES as SETTINGS_REGISTRATION_MODES } from "@workspace/settings/groups/instance-access";
import {
  rawCommentTargetEnum,
  rawEntityKindEnum,
  rawInstanceRoleEnum,
  rawMemberRoleEnum,
  rawSavedViewKindEnum,
} from "server/src/db/schema/enums.js";
import { DAW_CAPABILITIES as SERVER_DAW_CAPABILITIES } from "server/src/db/schema/sessions.js";
import { AUDIO_EXTENSIONS as SERVER_AUDIO_EXTENSIONS } from "@workspace/settings/groups/instance-limits";
import { collectionFilterSchema } from "server/src/entities/collection/filters.js";
import { sessionFilterSchema } from "server/src/entities/session/filters.js";
import { trackFilterSchema } from "server/src/entities/track/filters.js";
import {
  AUDIO_EXTENSIONS,
  COLLECTION_FILTER_PARAMS,
  COMMENT_TARGETS,
  DAW_CAPABILITIES,
  ENTITY_KINDS,
  INSTANCE_ROLES,
  MEMBER_ROLES,
  REGISTRATION_MODES,
  SAVED_VIEW_KINDS,
  SESSION_FILTER_PARAMS,
  TRACK_FILTER_PARAMS,
} from "./enums";

// packages/api/src/enums.ts is generated from these server-side source arrays
// by apps/server/scripts/generate-api.ts. If a pgEnum changes and someone
// forgets to regenerate, the client silently ships stale options — this test
// is the regression guard.
describe("generated enums match their server source arrays", () => {
  it("MEMBER_ROLES", () => {
    expect([...MEMBER_ROLES]).toEqual([...rawMemberRoleEnum]);
  });

  it("INSTANCE_ROLES", () => {
    expect([...INSTANCE_ROLES]).toEqual([...rawInstanceRoleEnum]);
  });

  it("REGISTRATION_MODES", () => {
    expect([...REGISTRATION_MODES]).toEqual([...SETTINGS_REGISTRATION_MODES]);
  });

  it("ENTITY_KINDS", () => {
    expect([...ENTITY_KINDS]).toEqual([...rawEntityKindEnum]);
  });

  it("COMMENT_TARGETS", () => {
    expect([...COMMENT_TARGETS]).toEqual([...rawCommentTargetEnum]);
  });

  it("SAVED_VIEW_KINDS", () => {
    expect([...SAVED_VIEW_KINDS]).toEqual([...rawSavedViewKindEnum]);
  });

  it("AUDIO_EXTENSIONS", () => {
    expect([...AUDIO_EXTENSIONS]).toEqual([...SERVER_AUDIO_EXTENSIONS]);
  });

  it("DAW_CAPABILITIES", () => {
    expect([...DAW_CAPABILITIES]).toEqual([...SERVER_DAW_CAPABILITIES]);
  });
});

// Each listing's paginated query schema is built from its filter schema, and
// the filter params are generated from the same one: a filter added on the
// server without regenerating fails here, where the client's static list
// once silently lacked `explicit`.
describe("generated filter params match the listings' filter schemas", () => {
  it("TRACK_FILTER_PARAMS, explicit among them", () => {
    expect<string[]>([...TRACK_FILTER_PARAMS]).toEqual(
      Object.keys(trackFilterSchema.shape)
    );
    expect(TRACK_FILTER_PARAMS).toContain("explicit");
  });

  it("COLLECTION_FILTER_PARAMS", () => {
    expect<string[]>([...COLLECTION_FILTER_PARAMS]).toEqual(
      Object.keys(collectionFilterSchema.shape)
    );
  });

  it("SESSION_FILTER_PARAMS", () => {
    expect<string[]>([...SESSION_FILTER_PARAMS]).toEqual(
      Object.keys(sessionFilterSchema.shape)
    );
  });
});
