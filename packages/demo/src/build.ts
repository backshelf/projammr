import { basename, dirname, join } from "node:path";
import type { DawCapability } from "@workspace/api/lib/enums";
import { type DemoApi, formData, must, type Session, waitForJobs } from "./api";
import { toBlocks } from "./blocks";
import { type DemoSet, saveMeta, setFacts } from "./demo-set";
import { hashOf, planPush, pushHistory, standInSet } from "./dit-history";
import { coverPath, findTrack, primaryIndex } from "./lookup";
import {
  type Cover,
  DEMO_PRIORITY_LEVELS,
  type DemoCatalogue,
  type DemoComment,
  type DemoPriority,
  type DemoProject,
  type DemoSavedView,
  type DemoSession,
} from "./model";
import type { SeedResult } from "./seed-result";
import { buildHistory, type HistoricSave } from "./session-history";

type CommentTarget =
  "project" | "collection" | "track" | "session" | "track_audio";

const path = (id: number) => ({ path: { id: String(id) } });

/** What a session of an Ableton set carries, as dit reports it. */
const ABLETON_LIVE = {
  daw: "ableton",
  dawName: "Ableton Live",
  dawCapabilities: [
    "tempo",
    "key",
    "timeSignature",
    "dawVersion",
    "structure",
    "clips",
    "scenes",
    "plugins",
    "samplePaths",
    "backups",
    "trackColors",
  ] satisfies DawCapability[],
};

/** What the demo's machine says it runs. */
const DEMO_APP_VERSION = "1.0.0";

/**
 * Builds the catalogue against an empty instance, as its people would: the
 * first account signs up and becomes the instance admin, everyone else joins
 * through a project invite, audio goes up as uploads the server analyses, and
 * the session's history goes up the way dit pushes it.
 */
export class Builder {
  private readonly people = new Map<string, Session>();
  private readonly jobs = new Map<string, number[]>();
  /** The repos each machine has beat so far, by machine id. */
  private readonly tracked = new Map<string, number[]>();
  readonly result: SeedResult;

  constructor(
    private readonly api: DemoApi,
    private readonly catalogue: DemoCatalogue,
    /** The directory `curate.ts` filled: the audio, and `sets/<session>.json`. */
    private readonly inputs: string,
    private readonly log: (line: string) => void
  ) {
    this.result = {
      api: api.baseUrl,
      accounts: Object.fromEntries(
        catalogue.accounts.map((a) => [
          a.key,
          { email: a.email, password: a.password },
        ])
      ),
      projects: {},
      shareLinks: [],
      notes: [],
    };
  }

  async run(): Promise<SeedResult> {
    const [first] = this.catalogue.accounts;
    if (!first) throw new Error("the catalogue has no accounts");
    this.people.set(first.key, await this.api.signUp(first));
    this.log(`signed up ${first.email} (instance admin)`);

    // The hub drops the content of saves no commit names once they are older
    // than the instance's retention, and most of the history's saves are
    // months old. The demo keeps all of it for as long as the setting allows.
    must(
      await this.person(first.key).api.PATCH("/api/settings/{scope}/{id}", {
        params: { path: { scope: "instance", id: "instance" } },
        body: { "instance-jobs.saveContentRetentionDays": 36_500 },
      }),
      "save content retention"
    );

    // A project is built once its owner has an account; an owner who is not
    // the first account signs up through an earlier project's invite.
    const queue = [...this.catalogue.projects];
    while (queue.length) {
      const next = queue.findIndex((p) => this.people.has(p.owner));
      if (next === -1) {
        throw new Error(
          `no account can create ${queue.map((p) => p.key).join(", ")}`
        );
      }
      const [project] = queue.splice(next, 1);
      await this.project(project!);
    }

    for (const link of this.catalogue.shareLinks) await this.shareLink(link);
    for (const note of this.catalogue.notes) {
      const author = this.person(note.author);
      const created = must(
        await author.api.POST("/api/notes", {
          body: { body: toBlocks(note.body, "note"), lyricsMode: false },
        }),
        "note"
      );
      this.result.notes.push(created.id);
      if (note.pinned) {
        must(
          await author.api.PATCH("/api/notes/{id}", {
            params: path(created.id),
            body: { version: created.version, pinned: true },
          }),
          "pin note"
        );
      }
    }
    this.log(`wrote ${this.catalogue.notes.length} notebook notes`);

    for (const project of this.catalogue.projects) {
      const ids = this.jobs.get(project.key) ?? [];
      if (!ids.length) continue;
      this.log(`waiting for ${ids.length} jobs in ${project.name}`);
      await waitForJobs(this.person(project.owner).api, ids, this.log);
    }
    return this.result;
  }

  private person(key: string): Session {
    const session = this.people.get(key);
    if (!session) throw new Error(`${key} has no account yet`);
    return session;
  }

  private queueJobs(project: DemoProject, ids: (number | null | undefined)[]) {
    const list = this.jobs.get(project.key) ?? [];
    list.push(...ids.filter((id): id is number => typeof id === "number"));
    this.jobs.set(project.key, list);
  }

  private async project(project: DemoProject) {
    const owner = this.person(project.owner);
    const created = must(
      await owner.api.POST("/api/projects", {
        body: {
          name: project.name,
          description: toBlocks(project.description, "note"),
          links: project.links,
        },
      }),
      `project ${project.key}`
    );
    const projectId = created.id;
    const built: SeedResult["projects"][string] = {
      id: projectId,
      tracks: {},
      trackAudios: {},
      collections: {},
      sessions: {},
      lyrics: {},
      invites: {},
    };
    this.result.projects[project.key] = built;
    this.log(`project ${project.name} (#${projectId})`);

    const covers = new Map<Cover, number>();
    const setCover = async (
      kind: "project" | "collection" | "track",
      parentId: number,
      cover?: Cover
    ) => {
      if (!cover) return;
      let imageId = covers.get(cover);
      if (imageId === undefined) {
        const file = Bun.file(coverPath(cover));
        const image = must(
          await owner.api.POST("/api/images/upload", {
            body: {
              file: new File([file], `${cover}.jpg`, {
                type: "image/jpeg",
              }) as unknown as string,
              projectId,
            },
            bodySerializer: formData,
          }),
          `cover ${cover}`
        );
        imageId = image.id;
        covers.set(cover, imageId);
        this.queueJobs(project, [image.variantsJobId]);
      }
      must(
        await owner.api.PUT("/api/images/parent/{kind}/{parentId}", {
          params: { path: { kind, parentId: String(parentId) } },
          body: { imageId },
        }),
        `${kind} ${parentId} cover`
      );
    };
    await setCover("project", projectId, project.cover);

    for (const member of project.members) {
      const invite = must(
        await owner.api.POST("/api/projects/{id}/invites", {
          params: path(projectId),
          body: {
            email: this.account(member.account).email,
            role: member.role,
          },
        }),
        `invite ${member.account}`
      );
      if (!invite.token)
        throw new Error(`invite for ${member.account} has no token`);
      const person =
        this.people.get(member.account) ?? (await this.signUp(member.account));
      must(
        await person.api.POST("/api/invites/{token}/accept", {
          params: { path: { token: invite.token } },
        }),
        `${member.account} accepts`
      );
    }
    for (const invite of project.invites) {
      const created = must(
        await owner.api.POST("/api/projects/{id}/invites", {
          params: path(projectId),
          body: { email: invite.email, role: invite.role },
        }),
        `invite ${invite.email}`
      );
      if (created.token) built.invites[invite.email] = created.token;
    }

    for (const status of project.statuses) {
      must(
        await owner.api.POST("/api/statuses", {
          body: { ...status, projectId },
        }),
        `status ${status.name}`
      );
    }
    const statuses = new Map(
      must(
        await owner.api.GET("/api/projects/{id}/statuses", {
          params: path(projectId),
        }),
        "statuses"
      ).map((s) => [s.name, s.id])
    );
    const statusId = (name: string) => {
      const id = statuses.get(name);
      if (id === undefined)
        throw new Error(`${project.key}: no status "${name}"`);
      return id;
    };

    const levels = new Map(
      must(
        await owner.api.GET("/api/projects/{id}/priorities", {
          params: path(projectId),
        }),
        "priority levels"
      ).map((level) => [level.name, level.id])
    );
    const priorityId = (priority: DemoPriority) => {
      const name = DEMO_PRIORITY_LEVELS[priority];
      const id = levels.get(name);
      if (id === undefined)
        throw new Error(`${project.key}: no priority level "${name}"`);
      return id;
    };

    const labels = new Map<string, number>();
    for (const label of project.labels) {
      const created = must(
        await owner.api.POST("/api/projects/{id}/labels", {
          params: path(projectId),
          body: label,
        }),
        `label ${label.name}`
      );
      labels.set(label.name, created.id);
    }
    const labelIds = (names: string[]) => names.map((n) => labels.get(n)!);

    const sessionFor = new Map(project.sessions.map((s) => [s.track, s]));
    const assetsByTrack = new Map<string, number[]>();
    for (const track of project.tracks) {
      const created = must(
        await owner.api.POST("/api/tracks", {
          body: {
            title: track.title,
            projectId,
            artists: track.artists,
            priorityId: priorityId(track.priority),
            statusId: statusId(track.status),
            notes: toBlocks(track.notes, "note"),
            explicit: track.explicit ?? false,
          },
        }),
        `track ${track.key}`
      );
      built.tracks[track.key] = created.id;
      await setCover("track", created.id, track.cover);
      if (track.labels.length) {
        must(
          await owner.api.PUT("/api/tracks/{id}/labels", {
            params: path(created.id),
            body: { labelIds: labelIds(track.labels) },
          }),
          `${track.key} labels`
        );
      }

      // A track with a session was bounced on the producer's machine, so its
      // files carry their local paths.
      const session = sessionFor.get(track.key);
      const assetIds: number[] = [];
      const audioIds: number[] = [];
      for (const version of track.versions) {
        const file = Bun.file(join(this.inputs, version.file));
        const asset = must(
          await owner.api.POST("/api/assets/upload", {
            body: {
              file: new File([file], version.name, {
                type: "audio/mpeg",
              }) as unknown as string,
              projectId,
              ...(session
                ? {
                    localFilepath: join(
                      dirname(session.localPath),
                      "Bounces",
                      version.name
                    ),
                    localFileMachineName: session.machine,
                  }
                : {}),
            },
            bodySerializer: formData,
          }),
          `upload ${version.file}`
        );
        const linked = must(
          await owner.api.POST("/api/tracks/{id}/audios", {
            params: path(created.id),
            body: { assetIds: [asset.id] },
          }),
          `link ${version.file}`
        );
        const audio = linked.audios.find((a) => a.assetId === asset.id);
        if (!audio)
          throw new Error(`${version.file} was not linked to ${track.key}`);
        assetIds.push(asset.id);
        audioIds.push(audio.id);
        this.queueJobs(project, linked.analysisJobIds);
      }
      must(
        await owner.api.PATCH("/api/track-audios/{id}/primary", {
          params: path(audioIds[primaryIndex(track)]!),
        }),
        `${track.key} primary`
      );
      built.trackAudios[track.key] = audioIds;
      assetsByTrack.set(track.key, assetIds);
      this.log(`  track ${track.title}: ${audioIds.length} versions`);
    }

    const relationTypes = new Map(
      must(
        await owner.api.GET("/api/projects/{id}/relation-types", {
          params: path(projectId),
        }),
        "relation types"
      ).map((type) => [type.name, type.id])
    );
    const relationTypeId = (name: string) => {
      const id = relationTypes.get(name);
      if (id === undefined)
        throw new Error(`${project.key}: no relation type "${name}"`);
      return id;
    };

    for (const track of project.tracks) {
      for (const relation of track.relations ?? []) {
        must(
          await owner.api.POST("/api/tracks/{id}/relations", {
            params: path(built.tracks[track.key]!),
            body: {
              toTrackId: built.tracks[relation.to]!,
              relationTypeId: relationTypeId(relation.relation),
            },
          }),
          `${track.key} ${relation.relation} ${relation.to}`
        );
      }
    }

    for (const collection of project.collections) {
      const created = must(
        await owner.api.POST("/api/collections", {
          body: {
            title: collection.title,
            projectId,
            notes: toBlocks(collection.notes, "note"),
            priorityId: priorityId(collection.priority),
            statusId: statusId(collection.status),
            releaseDate: collection.releaseDate ?? null,
          },
        }),
        `collection ${collection.key}`
      );
      built.collections[collection.key] = created.id;
      await setCover("collection", created.id, collection.cover);
      if (collection.labels.length) {
        must(
          await owner.api.PUT("/api/collections/{id}/labels", {
            params: path(created.id),
            body: { labelIds: labelIds(collection.labels) },
          }),
          `${collection.key} labels`
        );
      }
      for (const [i, key] of collection.tracks.entries()) {
        must(
          await owner.api.POST("/api/collections/{id}/tracks", {
            params: path(created.id),
            body: { trackId: built.tracks[key]!, trackNumber: i + 1 },
          }),
          `${collection.key} track ${key}`
        );
      }
      this.log(`  collection ${collection.title}`);
    }

    for (const session of project.sessions) {
      built.sessions[session.key] = await this.session(
        owner,
        projectId,
        session,
        built.tracks[session.track]!,
        assetsByTrack.get(session.track) ?? []
      );
    }

    // Comments go up last, each from its own author.
    const comment = (
      target: CommentTarget,
      targetId: number,
      c: DemoComment,
      positionMs?: number
    ) => this.comment(target, targetId, c, positionMs);
    for (const c of project.comments ?? [])
      await comment("project", projectId, c);
    for (const track of project.tracks) {
      for (const c of track.comments ?? [])
        await comment("track", built.tracks[track.key]!, c);
      for (const [i, version] of track.versions.entries()) {
        for (const pin of version.pins) {
          await comment(
            "track_audio",
            built.trackAudios[track.key]![i]!,
            pin,
            pin.atMs
          );
        }
      }
      if (track.lyrics) {
        built.lyrics[track.key] = must(
          await this.person(track.lyrics.author).api.POST("/api/notes", {
            body: {
              body: toBlocks(track.lyrics.lines, "lyrics"),
              trackId: built.tracks[track.key]!,
              lyricsMode: true,
            },
          }),
          `${track.key} lyrics`
        ).id;
      }
    }
    for (const collection of project.collections) {
      for (const c of collection.comments ?? [])
        await comment("collection", built.collections[collection.key]!, c);
    }
    for (const session of project.sessions) {
      for (const c of session.comments ?? [])
        await comment("session", built.sessions[session.key]!, c);
    }

    for (const view of project.savedViews) {
      await this.savedView(
        projectId,
        view,
        statuses,
        labels,
        built.collections
      );
    }
  }

  private account(key: string) {
    const account = this.catalogue.accounts.find((a) => a.key === key);
    if (!account) throw new Error(`no account "${key}"`);
    return account;
  }

  /** Registration closes after the first account, so this works only for an invited address. */
  private async signUp(key: string) {
    const account = this.account(key);
    const session = await this.api.signUp(account);
    this.people.set(key, session);
    this.log(`  signed up ${account.email}`);
    return session;
  }

  private async comment(
    target: CommentTarget,
    targetId: number,
    c: DemoComment,
    positionMs?: number
  ) {
    const created = must(
      await this.person(c.author).api.POST("/api/comments", {
        body: { targetType: target, targetId, content: c.text, positionMs },
      }),
      `comment on ${target} ${targetId}`
    );
    for (const reply of c.replies ?? []) {
      must(
        await this.person(reply.author).api.POST("/api/comments", {
          body: {
            targetType: target,
            targetId,
            content: reply.text,
            parentId: created.id,
          },
        }),
        `reply on ${target} ${targetId}`
      );
    }
  }

  /**
   * The session as its producer's machine leaves it on the hub: the session
   * row with the set's facts and samples, a repo holding the set, the saves,
   * commits and time spans dit would have pushed, and the track's bounces
   * attached. The sample statuses ride on the row, because a push records
   * only whether a sample is present or unknown.
   */
  private async session(
    owner: Session,
    projectId: number,
    session: DemoSession,
    trackId: number,
    assetIds: number[]
  ) {
    const set = (await Bun.file(
      join(this.inputs, "sets", `${session.key}.json`)
    ).json()) as DemoSet;
    const saves: HistoricSave[] = [
      ...buildHistory(set, session),
      {
        fileUpdatedAt: Date.parse(session.savedAt),
        kind: "milestone",
        message: session.savedMessage,
        meta: saveMeta(set),
      },
    ];

    const created = must(
      await owner.api.POST("/api/sessions", {
        body: {
          name: basename(session.localPath, ".als"),
          ...ABLETON_LIVE,
          localFilepath: session.localPath,
          main: session.main,
          projectId,
          trackId,
          localFileCreatedAt: saves[0]!.fileUpdatedAt,
          localFileUpdatedAt: Date.parse(session.savedAt),
          localFileMachineName: session.machine,
          ...setFacts(set),
          samples: set.samples ?? null,
        },
      }),
      `session ${session.key}`
    );

    const repo = must(
      await owner.api.POST("/api/projects/{id}/repos", {
        params: path(projectId),
        body: { name: basename(dirname(session.localPath)) },
      }),
      `repo of ${session.key}`
    );
    must(
      await owner.api.POST("/api/repos/{id}/sets", {
        params: path(repo.id),
        body: {
          ditSetId: session.key,
          fileName: basename(session.localPath),
          sessionId: created.id,
        },
      }),
      `set ${session.key}`
    );
    const machineId = await this.beat(owner, session.machine, repo.id);

    const standIn = standInSet();
    await pushHistory(
      owner.api,
      repo.id,
      session.key,
      machineId,
      planPush(session.key, session.machine, saves, standIn),
      standIn
    );

    for (const assetId of assetIds) {
      must(
        await owner.api.POST("/api/sessions/{id}/attachments", {
          params: path(created.id),
          body: { assetId },
        }),
        `session ${session.key} attachment`
      );
    }
    this.log(
      `  session ${created.name}: ${saves.length} saves in ${repo.name}`
    );
    return created.id;
  }

  /**
   * A beat from the machine `name` of `owner`'s, which registers it on its
   * first and names every repo it tracks so far on each. Returns its id, which
   * a push names in `X-Machine-Id`.
   */
  private async beat(owner: Session, name: string, repoId: number) {
    const id = hashOf(`${owner.userId} ${name}`).slice(0, 32);
    const repoIds = [...(this.tracked.get(id) ?? []), repoId];
    this.tracked.set(id, repoIds);
    must(
      await owner.api.PUT("/api/machines/{id}", {
        params: { path: { id } },
        body: {
          name,
          platform: "macOS",
          appVersion: DEMO_APP_VERSION,
          openSessionId: null,
          repoIds,
        },
      }),
      `machine ${name}`
    );
    return id;
  }

  private async savedView(
    projectId: number,
    view: DemoSavedView,
    statuses: Map<string, number>,
    labels: Map<string, number>,
    collections: Record<string, number>
  ) {
    const query = new URLSearchParams();
    if (view.sort) query.set("sort", view.sort);
    if (view.group) query.set("group", view.group);
    if (view.filter?.status)
      query.set("status", String(statuses.get(view.filter.status)));
    if (view.filter?.label)
      query.set("label", String(labels.get(view.filter.label)));
    if (view.filter?.collection)
      query.set("collection", String(collections[view.filter.collection]));

    const owner = this.person(view.owner);
    const created = must(
      await owner.api.POST("/api/projects/{id}/saved-views", {
        params: path(projectId),
        body: {
          name: view.name,
          kind: view.kind,
          config: { query: query.toString() },
        },
      }),
      `saved view ${view.name}`
    );
    if (view.shared) {
      must(
        await owner.api.PATCH("/api/projects/{id}/saved-views/{viewId}", {
          params: {
            path: { id: String(projectId), viewId: String(created.id) },
          },
          body: { shared: true },
        }),
        `share view ${view.name}`
      );
    }
  }

  private async shareLink(link: DemoCatalogue["shareLinks"][number]) {
    const built = this.result.projects[link.project]!;
    const entityId =
      link.entity.kind === "collection"
        ? built.collections[link.entity.key]!
        : built.tracks[link.entity.key]!;
    const owner = this.person(link.owner);
    const share = must(
      await owner.api.POST(
        link.type === "snapshot"
          ? "/api/share/snapshot"
          : "/api/share/connected",
        {
          body: {
            entityType: link.entity.kind,
            entityId,
            description: link.description,
          },
        }
      ),
      `share ${link.entity.key}`
    );
    this.result.shareLinks.push({
      project: link.project,
      entity: link.entity.key,
      token: share.token,
    });

    for (const comment of link.guestComments) {
      const guest = await this.api.guest(comment.name);
      const page = must(
        await guest.api.GET("/api/share/{token}", {
          params: { path: { token: share.token } },
        }),
        "share page"
      );
      const project = this.catalogue.projects.find(
        (p) => p.key === link.project
      )!;
      const trackKey =
        comment.track ??
        (link.entity.kind === "track" ? link.entity.key : undefined);
      if (!trackKey || !findTrack(project, trackKey))
        throw new Error(`guest comment names no track`);
      const trackAudioId = page.tracks.find(
        (t) => t.trackAudio.trackId === built.tracks[trackKey]
      )?.trackAudio.id;
      if (trackAudioId === undefined)
        throw new Error(`${trackKey} is not on the share page`);
      must(
        await guest.api.POST("/api/share/{token}/comments", {
          params: { path: { token: share.token } },
          body: {
            trackAudioId,
            content: comment.text,
            positionMs: comment.atMs,
          },
        }),
        `guest comment by ${comment.name}`
      );
    }
    this.log(`share link /share/${share.token}`);
  }
}
