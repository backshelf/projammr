# Third-party notices

Projammr bundles third-party data whose licences require their notices to travel with the product. The notices below
cover the data sets; the npm packages that wrap them (`cmu-pronouncing-dictionary`, ISC © Zeke Sikelianos; `wordpos`
and `wordnet-db`, MIT © Moos; `syllable`, MIT © Titus Wormer) carry their own licences in `node_modules`.

## CMU Pronouncing Dictionary

Used by `apps/server/src/lib/pronunciation.ts` for syllable counts and rhyme keys, via the
[`cmu-pronouncing-dictionary`](https://github.com/words/cmu-pronouncing-dictionary) package, which crawls
[`cmusphinx/cmudict`](https://github.com/cmusphinx/cmudict).

```
Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
   The contents of this file are deemed to be source code.

2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in
   the documentation and/or other materials provided with the
   distribution.

This work was supported in part by funding from the Defense Advanced
Research Projects Agency, the Office of Naval Research and the National
Science Foundation of the United States of America, and by member
companies of the Carnegie Mellon Sphinx Speech Consortium. We acknowledge
the contributions of many volunteers to the expansion and improvement of
this dictionary.

THIS SOFTWARE IS PROVIDED BY CARNEGIE MELLON UNIVERSITY ``AS IS'' AND
ANY EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL CARNEGIE MELLON UNIVERSITY
NOR ITS EMPLOYEES BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## WordNet

Used for synonyms and commonness, via the [`wordnet-db`](https://github.com/moos/wordnet-db) package (WordNet 3.1
database files) read by [`wordpos`](https://github.com/moos/wordpos). Reproduced verbatim from that package's
`LICENSE`, which ships the Princeton University licence text under its Release 3.0 heading.

```
WordNet Release 3.0

This software and database is being provided to you, the LICENSEE, by
Princeton University under the following license.  By obtaining, using
and/or copying this software and database, you agree that you have
read, understood, and will comply with these terms and conditions.:

Permission to use, copy, modify and distribute this software and
database and its documentation for any purpose and without fee or
royalty is hereby granted, provided that you agree to comply with
the following copyright notice and statements, including the disclaimer,
and that the same appear on ALL copies of the software, database and
documentation, including modifications that you make for internal
use or for distribution.

WordNet 3.0 Copyright 2006 by Princeton University.  All rights reserved.

THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON
UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR
IMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON
UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANT-
ABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE
OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT
INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR
OTHER RIGHTS.

The name of Princeton University or Princeton may not be used in
advertising or publicity pertaining to distribution of the software
and/or database.  Title to copyright in this software, database and
any associated documentation shall at all times remain with
Princeton University and LICENSEE agrees to preserve same.
```

## ffmpeg

The API image runs `ffmpeg` for audio decoding and waveform work. It is copied from the
[`mwader/static-ffmpeg`](https://github.com/wader/static-ffmpeg) image (pinned by digest in the `Dockerfile`), a static
build configured with `--enable-gpl --enable-version3`, so the binary is licensed GPL-3.0-or-later. That licence is
compatible with distributing Projammr under AGPL-3.0. ffmpeg runs as a separate process and is not linked into
Projammr. ffmpeg's source is at [ffmpeg.org](https://ffmpeg.org/download.html#get-sources); the build recipe and the
sources of its components are in the [`wader/static-ffmpeg`](https://github.com/wader/static-ffmpeg) repository.

## sharp and libvips

The server and the marketing site use [`sharp`](https://github.com/lovell/sharp) (Apache-2.0), which loads prebuilt
[libvips](https://github.com/libvips/libvips) binaries (`@img/sharp-libvips-*`) licensed LGPL-3.0-or-later. They are
used unmodified, as shared libraries; libvips' source is at the linked repository.

## MPL-2.0 dependencies

These packages are licensed under the Mozilla Public License 2.0 (<https://www.mozilla.org/MPL/2.0/>). They are used
unmodified, and their source is available from the linked repositories.

- [BlockNote](https://github.com/TypeCellOS/BlockNote): `@blocknote/core`, `@blocknote/react` and `@blocknote/shadcn`,
  the rich-text editor behind session notes.
- [`lightningcss`](https://github.com/parcel-bundler/lightningcss): a build-time dependency of the Tailwind CSS
  toolchain.

## Tabler Icons

Icons come from [Tabler Icons](https://github.com/tabler/tabler-icons) via `@tabler/icons-react`, MIT © Paweł Kuna.

## Fonts

`packages/ui/src/styles/fonts.css` loads four self-hosted typefaces, each licensed under the SIL Open Font License 1.1
(<https://openfontlicense.org>):

- [Redaction](https://www.redaction.us/) and Redaction 35, © 2019 MCKL.
- [Departure Mono](https://departuremono.com/), © 2022–2024 Helena Zhang.
- [Spline Sans Mono](https://github.com/SorkinType/SplineSansMono), © 2022 The Spline Sans Mono Project Authors.
