# Product

<!-- impeccable:product-schema 1 -->

Shared by every surface in the monorepo: the web client (`apps/client`), dit, the desktop DAW reader
(`apps/dit-app`), the public site and docs (`apps/web`) and the shared component library (`packages/ui`). They are
one product and must read as one.

## Platform

web

dit's menu bar app is a Tauri window whose panel runs the same web stack and design tokens as the client; it is
not a native design language.

## Users

**Primary: a music producer working with a small circle of collaborators.** The producer owns the projects,
runs dit against their Ableton project folders, and uses Projammr to see where every song stands, what
changed in the last session, and what needs listening or finishing next.

**Collaborators** are project members (co-writers, band members, a mix engineer). They:

- listen to versions and leave timecoded feedback on the audio;
- co-manage the work alongside the producer: statuses, tracks, notes and collections.

**Outsiders** (labels, managers, friends) are not members. They hear a session and comment through a share link,
on a public page with no app shell.

Only the producer is assumed to run dit; collaborators do not sync their own sessions.

## Product Purpose

Projammr keeps a music catalogue organised as **projects → collections → tracks → sessions**, with the audio,
feedback and history of each song in one place. Success means a producer and their collaborators always know the
state of every song, hear the latest version, and never lose a note, a lyric or a piece of feedback.

Today it is a personal tool for the owner's own work, with collaborators arriving through invites and share
links. It is open source and self-hostable, so any musician can run their own instance, and a public site pitches
and documents it. Paid hosting is planned but does not exist, and there is no public sign-up.

## Positioning

Four points together; a generic tracker (Notion, Trello) can claim none of them truthfully:

1. **It reads the DAW.** dit reads Ableton sessions directly, so saves, set structure, diffs between
   saves and plugins come from the work itself, not from manual entry.
2. **Listening-first review.** Audio versions, waveforms, timecoded comments, loudness measurement and a
   listening queue are the centre of how songs get reviewed.
3. **The whole song lifecycle.** One place from a lyric idea in the notebook, through sessions and versions, to a
   finished collection.
4. **Artwork-driven identity.** The music's own cover art gives each project, collection and track its identity,
   so the tool feels like part of the record, not an office app.

## Operating Context

- **The producer's machine:** dit runs in the menu bar, watches Ableton project folders, and pushes each save, render and track audio to the
  instance as a revision.
- **The web client:** desktop for managing and reviewing work (tables, entity pages, notebook, lyrics editor);
  phones for listening, checking status and commenting on the move.
- **Share pages:** a stranger opens a link, plays a session and comments without an account.
- **The public site (`apps/web`):** a producer arriving from a link or a search decides whether Projammr is worth
  running. The marketing pages persuade with the product itself (real gear, real screenshots of an invented demo
  catalogue); the docs cover using the app and dit, working together, running an instance, the API,
  self-hosting and contributing.
- **Vocabulary users already know:** Ableton sets, sessions and saves, renders, bounces, versions, BPM and key,
  LUFS, stems and samples, tracks and collections (EPs, albums).

## Capabilities and Constraints

- **Hierarchy:** projects, collections, tracks and sessions, with statuses (user-defined colours and a
  percentage), labels, priority, relations between tracks, attachments, images, comments and an activity feed.
- **Audio:** multiple audio versions per track, waveforms, timecoded comments per version, loudness (LUFS),
  a music player and a listening queue.
- **Session intelligence:** Ableton set structure, save-to-save diffs, plugin inventory, save timelines and
  activity heatmaps.
- **Writing:** an encrypted personal notebook whose notes can become track lyrics, and a lyrics editor with
  rhyme and dictionary help.
- **Collaboration:** project members with roles (viewer by default), invites, and public share links with
  comments.
- **dit:** ships with Ableton Live; others are added as modules.
- **Server authority:** the server is the source of truth for all data, including the accent colours extracted
  from artwork.
- **Distribution:** open source under AGPL-3.0, self-hosted with Docker Compose. Pricing has three plans:
  Self-hosted (free), and Hosted Solo and Hosted Studio, which differ by storage and member count. Hosting does not
  exist, so the site marks both hosted plans "Coming soon".
- **Open decisions:** the hosted plans' prices and when hosting launches. The site's prices are placeholders, and
  nothing may present hosting or a public sign-up as available.

## Brand Commitments

- The product name is **Projammr**.
- Artwork, not a brand hue, is the source of each page's identity (see Positioning). The visual rules that follow
  from this live in `DESIGN.md`.

## Evidence on Hand

- `samples/canopy Project/` and `samples/canopy ambient outro.xml`: a real Ableton project used as dit and
  session-structure fixtures.
- `fixtures/covers/*.jpg`: four cover images used as accent-extraction fixtures.
- `packages/demo`: an invented demo catalogue, lit by those four covers, that the site's product screenshots are
  taken from.
- No testimonials, users beyond the owner's circle, usage figures or press exist, and the hosted plans have no
  real prices. Future work must not invent them.

## Product Principles

1. **The work is the record.** Prefer facts read from the DAW, the audio and the server over anything a user has
   to type in by hand.
2. **Listening comes first.** Any surface about a song gets the producer and collaborators to hearing it and
   responding to it with as little friction as possible.
3. **One product, three surfaces.** The client, dit's app and the share page share one language, one set of
   primitives and one vocabulary.
4. **The music owns the identity.** The interface frames each project's artwork and never competes with it.
5. **Built for a circle, ready for more.** Design for the producer and collaborators who use it today without
   closing doors on a public product.

## Accessibility & Inclusion

WCAG 2.2 AA across the client, dit's app and share pages: contrast, keyboard access, visible focus, touch
target size and reduced motion.
