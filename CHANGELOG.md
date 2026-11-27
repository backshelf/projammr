# Changelog

All notable changes to Projammr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-27

### Added

- Projects that organise music as collections, tracks and sessions, with user-defined statuses, labels, track
  relations and attachments, and a command palette that searches everything in a project.
- Filterable, groupable, sortable lists with saved views, a board view and bulk edits.
- Cover art for every project, collection and track, which also sets the accent colour of the pages around it.
- Several audio versions per track, each measured on upload for loudness, true peak, tempo, key, sections, spectrum
  and clipping, with comparison between versions and duplicate detection.
- A persistent player with a queue, a live loudness meter and timecoded comments pinned to the waveform.
- The Lab: speed and pitch, EQ, compression, reverb and audition modes, with match EQ against another version and a
  bounce that downloads a 24-bit FLAC locally with an opt-in upload to the track.
- dit, a desktop app that watches your Ableton Live project folders, turns every save into a revision, and pushes
  them to your Projammr account.
- Session history that diffs any two saves, a work heatmap and a plugin inventory.
- A notebook with encrypted notes and lyrics, showing syllable counts, rhyme marks and rhyme and synonym lookups.
- Project members with roles, invites by email, ownership transfer and an activity feed.
- Share links for tracks and collections, as a frozen snapshot or connected to the live sequence, with guest
  comments, optional downloads and expiry.
- Background jobs with live progress, retry and cancel.
- An MCP endpoint so an AI client can read and write a project over OAuth, and an OpenAPI description of the whole
  API browsable at `/api/docs`.
- Installation as a PWA, and self-hosting with Docker.
- Bringing projects into dit: the app's window and `dit backfill` find your existing Ableton project folders, match
  their sets to sessions and tracks, and push their history to your account, resuming where they stopped.
- Machines: each Mac running dit registers under a name, listed in Settings › Devices where you can rename or remove
  it, and across the instance in Instance › Machines. Saves, commits and time are attributed to the machine that made
  them.
- Rejections shared through the hub: a backup or set you reject on one machine stays rejected on your others.
- dit updates itself from GitHub releases.
- Pluggable S3-compatible object storage (Cloudflare R2, AWS S3, MinIO) backing media, images, spectrograms, and dit
  objects, with a resumable local-to-S3 migration CLI (`dist/scripts/migrate-storage.js`) and streaming multipart
  uploads.
- Ableton Live extension (`extensions/ableton/`) for in-DAW commits, notes, and syncing timecoded comments to Live
  locators.
- Dedicated `dit` documentation section (`/docs/dit/`) and GitHub Pages deployment at
  `https://backshelf.github.io/projammr`.

### Removed

- The scanner, its upload routes and its `/scanner/` page on the site, replaced by dit and `/dit/`.
