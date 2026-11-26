/**
 * The demo world the marketing site's screenshots are taken from: a producer
 * (Ellis), three collaborators, three projects lit by the four covers in
 * `fixtures/covers/`, seventeen songs with their bounces, one Ableton set with
 * its save history, and the comments, notes, lyrics, views and share link a
 * small circle builds up around them.
 *
 * Every name here, song titles and file names included, is invented for the
 * demo. The audio and the set are real, supplied privately to `curate.ts`;
 * what they really are never enters this repository. In `DemoText`, a line
 * starting `# ` is a heading (a section, in lyrics) and an empty string is a
 * blank line.
 */
import type { DemoCatalogue } from "./model";

const PASSWORD = "demo-catalogue-2026";

export const catalogue: DemoCatalogue = {
  accounts: [
    {
      key: "ellis",
      name: "Ellis Marr",
      email: "ellis@example.com",
      password: PASSWORD,
    },
    {
      key: "juno",
      name: "Juno Adeyemi",
      email: "juno@example.com",
      password: PASSWORD,
    },
    {
      key: "tomas",
      name: "Tomás Ferreira",
      email: "tomas@example.com",
      password: PASSWORD,
    },
    {
      key: "priya",
      name: "Priya Raman",
      email: "priya@example.com",
      password: PASSWORD,
    },
  ],

  projects: [
    {
      key: "low-tide",
      name: "Low Tide",
      owner: "ellis",
      cover: "magenta",
      description: [
        "Everything for Low Tide: the Harbour Lights EP, the record we keep calling Longshore, and whatever turns up on a Tuesday night.",
        "Bounces land here straight from the studio machine. Comment on the version you are actually hearing, not the one you remember.",
      ],
      links: [
        {
          name: "Stems and session files",
          url: "https://example.com/low-tide/stems",
        },
        { name: "Artwork drafts", url: "https://example.com/low-tide/artwork" },
      ],
      members: [
        { account: "juno", role: "editor" },
        { account: "tomas", role: "editor" },
        { account: "priya", role: "editor" },
      ],
      invites: [{ email: "mo.hassan@example.com", role: "viewer" }],
      statuses: [
        {
          name: "Idea",
          colourHex: "#8A8A8A",
          percentage: 5,
          description: "A voice memo or a loop. Nothing committed yet.",
        },
        {
          name: "Writing",
          colourHex: "#9A7FD1",
          percentage: 20,
          description: "Structure and words are still moving.",
        },
        {
          name: "Tracking",
          colourHex: "#4A7FD4",
          percentage: 45,
          description: "Parts are being recorded for keeps.",
        },
        {
          name: "Mixing",
          colourHex: "#D9903D",
          percentage: 70,
          description: "With Tomás. Arrangement is locked.",
        },
        {
          name: "Mastering",
          colourHex: "#D4577A",
          percentage: 90,
          description: "Final masters being checked on every system we own.",
        },
        {
          name: "Released",
          colourHex: "#E4DCCB",
          percentage: 100,
          description: "Out in the world.",
        },
      ],
      labels: [
        { name: "single", colourHex: "#D4577A" },
        { name: "needs vocals", colourHex: "#9A7FD1" },
        { name: "live set", colourHex: "#4A7FD4" },
        { name: "sync pitch", colourHex: "#D9903D" },
      ],
      tracks: [
        {
          key: "kindling",
          title: "Kindling",
          artists: ["Low Tide"],
          status: "Mastering",
          priority: "high",
          cover: "sunset",
          labels: [],
          notes: [
            "Opens the EP. Mix 1 was close; the final bounce only moves the vocal and the top end.",
          ],
          versions: [
            {
              file: "kindling-1.mp3",
              name: "kindling - mix 1.mp3",
              durationMs: 180428,
              pins: [
                {
                  author: "tomas",
                  atMs: 31000,
                  text: "Kick and bass are fighting here. I'll carve the low end on the next pass.",
                },
                {
                  author: "juno",
                  atMs: 142000,
                  text: "Vocal disappears under the synth in this chorus.",
                },
              ],
            },
            {
              file: "kindling-2.mp3",
              name: "kindling - final.mp3",
              durationMs: 180428,
              pins: [
                {
                  author: "juno",
                  atMs: 142000,
                  text: "Much better, I can hear every word now.",
                },
              ],
            },
          ],
        },
        {
          key: "slow-parade",
          title: "Slow Parade",
          artists: ["Low Tide"],
          status: "Mastering",
          priority: "high",
          cover: "sunset",
          labels: ["single"],
          notes: [
            "Lead single for the EP. Goes out two weeks ahead of the release.",
          ],
          versions: [
            {
              file: "slow-parade-1.mp3",
              name: "slow parade - master.mp3",
              durationMs: 192000,
              pins: [
                {
                  author: "juno",
                  atMs: 21000,
                  text: "This intro is the best eight bars on the EP. Don't touch it.",
                },
                {
                  author: "tomas",
                  atMs: 74000,
                  text: "Automating the reverb send down into the chorus so it hits dry.",
                  replies: [
                    { author: "ellis", text: "Yes. It opens right up." },
                  ],
                },
                {
                  author: "priya",
                  atMs: 131000,
                  text: "Guitar double is a touch late here, I can re-track it Thursday.",
                },
                {
                  author: "ellis",
                  atMs: 172000,
                  text: "The ending lands so much better than the last bounce.",
                },
              ],
            },
          ],
          comments: [
            {
              author: "ellis",
              text: "Sending this to the label friend on Friday unless anyone objects.",
              replies: [{ author: "tomas", text: "Go for it." }],
            },
          ],
        },
        {
          key: "lifeguard",
          title: "Lifeguard",
          artists: ["Low Tide", "Juno Adeyemi"],
          status: "Mastering",
          priority: "medium",
          cover: "sunset",
          labels: [],
          notes: ["Juno's lyric, Ellis's chords. The slow one on the EP."],
          versions: [
            {
              file: "lifeguard-1.mp3",
              name: "lifeguard_0912.mp3",
              durationMs: 272001,
              pins: [
                {
                  author: "juno",
                  atMs: 38000,
                  text: "Can the vocal come up a touch in the first verse?",
                  replies: [
                    { author: "tomas", text: "Done in the next pass." },
                  ],
                },
                {
                  author: "priya",
                  atMs: 118000,
                  text: "Could the guitar take the melody here instead of the synth?",
                },
                {
                  author: "tomas",
                  atMs: 226000,
                  text: "Tamed the harshness around 3k without losing the air.",
                },
              ],
            },
          ],
          lyrics: {
            author: "juno",
            lines: [
              "# Verse 1",
              "Streetlights count me home again",
              "Every window holds a different kind of weather",
              "We climbed the fence behind the baths",
              "And swore the summer would go on forever",
              "",
              "# Chorus",
              "Meet me past the flags",
              "Where the lifeguard never looks",
              "Meet me past the flags",
              "Before the tide comes in",
              "",
              "# Verse 2",
              "Your towel is on the second hook",
              "I never moved it and I never really tried to",
              "The water's always colder than it looks",
              "And I still jump in the way you used to",
            ],
          },
        },
        {
          key: "coast-road",
          title: "Coast Road",
          artists: ["Low Tide"],
          status: "Mixing",
          priority: "medium",
          cover: "sunset",
          labels: ["live set"],
          notes: [
            "Seven and a half minutes and every one of them earns its place. Closes the EP and the live set.",
          ],
          versions: [
            {
              file: "coast-road-1.mp3",
              name: "coast road - full length.mp3",
              durationMs: 448496,
              pins: [
                {
                  author: "tomas",
                  atMs: 95000,
                  text: "The build here needs more low end, it thins out right as it should be growing.",
                },
                {
                  author: "juno",
                  atMs: 262000,
                  text: "This breakdown gives me chills every time.",
                },
                {
                  author: "ellis",
                  atMs: 401000,
                  text: "Long fade on purpose. It's the last thing people hear.",
                },
              ],
            },
          ],
        },
        {
          key: "longshore",
          title: "Longshore",
          artists: ["Low Tide"],
          status: "Mixing",
          priority: "high",
          cover: "teal",
          labels: ["needs vocals"],
          notes: [
            "Title track. The mix from the 17th is the one to beat; the second verse still needs a vocal.",
          ],
          versions: [
            {
              file: "longshore-1.mp3",
              name: "longshore-mix-0417.mp3",
              durationMs: 321881,
              pins: [
                {
                  author: "tomas",
                  atMs: 44000,
                  text: "Pulled the pads back so the verse has room for a vocal.",
                },
                {
                  author: "juno",
                  atMs: 150000,
                  text: "This is where the second verse vocal wants to come in.",
                  replies: [
                    {
                      author: "ellis",
                      text: "Booking the vocal session for next week.",
                    },
                  ],
                },
                {
                  author: "ellis",
                  atMs: 262000,
                  text: "The ending swell still clips on my car speakers.",
                },
              ],
            },
          ],
        },
        {
          key: "ridgeline",
          title: "Ridgeline",
          artists: ["Low Tide"],
          status: "Mixing",
          priority: "high",
          cover: "teal",
          labels: [],
          notes: [
            "Written on the drive back down the mountain. We tried an ambient outro, kept its breakdown and went back to the original ending for mix 2.",
          ],
          versions: [
            {
              file: "ridgeline-1.mp3",
              name: "ridgeline - mix 1.mp3",
              durationMs: 273241,
              pins: [
                {
                  author: "priya",
                  atMs: 95000,
                  text: "My part drifts behind the click here, I'll fix it on the next take.",
                },
              ],
            },
            {
              file: "ridgeline-2.mp3",
              name: "ridgeline - ambient outro then the breakdown.mp3",
              durationMs: 266664,
              pins: [
                {
                  author: "juno",
                  atMs: 186000,
                  text: "The breakdown is great. Not sold on the ambient outro.",
                },
                {
                  author: "tomas",
                  atMs: 232000,
                  text: "Agree with Juno, the outro loses the energy the breakdown built.",
                },
              ],
            },
            {
              file: "ridgeline-3.mp3",
              name: "ridgeline mix2.mp3",
              durationMs: 273241,
              pins: [
                {
                  author: "tomas",
                  atMs: 16000,
                  text: "Mix 2 is quieter on purpose so it survives the master.",
                },
                {
                  author: "juno",
                  atMs: 74000,
                  text: "The drums hit so much harder in this one.",
                  replies: [
                    {
                      author: "tomas",
                      text: "Parallel compression on the drum bus, glad it reads.",
                    },
                  ],
                },
                {
                  author: "priya",
                  atMs: 150000,
                  text: "I can double this riff on the baritone.",
                },
                {
                  author: "ellis",
                  atMs: 212000,
                  text: "Keeping the breakdown from the ambient version here. Best of both.",
                },
              ],
            },
          ],
          comments: [
            {
              author: "juno",
              text: "Mix 2 is the one. Can we stop bouncing new versions of this for a week?",
              replies: [{ author: "ellis", text: "No promises." }],
            },
          ],
        },
        {
          key: "halogen",
          title: "Halogen",
          artists: ["Low Tide"],
          status: "Mixing",
          priority: "urgent",
          cover: "magenta",
          labels: ["single"],
          notes: [
            "The big one: seventy-seven tracks in the set. Needs printing to stems before the mix session.",
          ],
          versions: [
            {
              file: "halogen-1.mp3",
              name: "halogen - mix 9.mp3",
              durationMs: 249626,
              pins: [
                {
                  author: "tomas",
                  atMs: 33000,
                  text: "Arps are masking the vocal chops. Notching them around 2k.",
                },
                {
                  author: "juno",
                  atMs: 96000,
                  text: "The vocoder part here is my favourite moment on the record.",
                },
                {
                  author: "juno",
                  atMs: 124000,
                  text: "Drop lands so much harder with the sidechain pumping like this.",
                  replies: [
                    {
                      author: "tomas",
                      text: "That's the ring mod on the sidechain bus, glad it reads.",
                    },
                  ],
                },
                {
                  author: "ellis",
                  atMs: 212000,
                  text: "Long outro is the one. Keeping it.",
                },
              ],
            },
          ],
          comments: [
            {
              author: "juno",
              text: "Can we get a radio edit of this one?",
              replies: [
                {
                  author: "ellis",
                  text: "After the stems are printed. The long outro stays on the record.",
                },
              ],
            },
          ],
        },
        {
          key: "tall-grass",
          title: "Tall Grass",
          artists: ["Low Tide"],
          status: "Tracking",
          priority: "low",
          cover: "teal",
          labels: ["sync pitch"],
          notes: [
            "Two lengths on the go: the full version for the record, the live edit for the set.",
          ],
          versions: [
            {
              file: "tall-grass-1.mp3",
              name: "tall grass - album length.mp3",
              durationMs: 401998,
              pins: [
                {
                  author: "priya",
                  atMs: 300000,
                  text: "Room for a guitar solo in this break?",
                },
              ],
            },
            {
              file: "tall-grass-2.mp3",
              name: "tall grass - live edit.mp3",
              durationMs: 327497,
              pins: [
                {
                  author: "ellis",
                  atMs: 140000,
                  text: "The edit point is here, crossfade needs another pass.",
                },
                {
                  author: "tomas",
                  atMs: 281000,
                  text: "Edit works. Nobody will miss the extra minute live.",
                },
              ],
            },
          ],
        },
        {
          key: "soon-enough",
          title: "Soon Enough",
          artists: ["Low Tide", "Juno Adeyemi"],
          status: "Writing",
          priority: "medium",
          cover: "teal",
          labels: ["needs vocals"],
          notes: ["Second verse still has no words."],
          versions: [
            {
              file: "soon-enough-1.mp3",
              name: "soon-enough-mix-0428.mp3",
              durationMs: 266136,
              pins: [
                {
                  author: "juno",
                  atMs: 101000,
                  text: "Second verse needs words, I'll have a go this weekend.",
                },
                {
                  author: "tomas",
                  atMs: 229000,
                  text: "New outro adds forty seconds. Worth it.",
                },
              ],
            },
          ],
          lyrics: {
            author: "juno",
            lines: [
              "# Verse 1",
              "There's a letter on the dashboard",
              "Folded like it's waiting to be sent",
              "The city hums a song we used to hum",
              "And every red light asks me where you went",
              "",
              "# Chorus",
              "Soon enough",
              "I'll find the words to say it",
              "When the harbour goes quiet",
              "Soon enough",
            ],
          },
        },
        {
          key: "nerve",
          title: "Nerve",
          artists: ["Low Tide"],
          status: "Tracking",
          priority: "medium",
          cover: "teal",
          labels: [],
          notes: ["Called fin1 for a reason. Only the drums left to re-track."],
          versions: [
            {
              file: "nerve-1.mp3",
              name: "nerve-fin1.mp3",
              durationMs: 208588,
              pins: [
                {
                  author: "priya",
                  atMs: 61000,
                  text: "Such a lift from the demo.",
                },
                {
                  author: "tomas",
                  atMs: 150000,
                  text: "Snare needs to cut more in this section.",
                },
              ],
            },
          ],
        },
      ],
      collections: [
        {
          key: "harbour-lights",
          title: "Harbour Lights",
          cover: "sunset",
          status: "Mastering",
          priority: "high",
          releaseDate: "2026-11-06",
          labels: [],
          notes: [
            "# Harbour Lights EP",
            "Four songs about the drive home. Masters due mid October for a November release.",
            "Running order is locked: Kindling, Slow Parade, Lifeguard, Coast Road.",
          ],
          tracks: ["kindling", "slow-parade", "lifeguard", "coast-road"],
          comments: [
            {
              author: "tomas",
              text: "All four masters are within half a dB of each other now.",
            },
          ],
        },
        {
          key: "longshore-album",
          title: "Longshore",
          cover: "teal",
          status: "Tracking",
          priority: "medium",
          labels: [],
          notes: [
            "# Longshore",
            "The album. Six songs so far, aiming for ten. Vocals are the long pole.",
          ],
          tracks: [
            "longshore",
            "ridgeline",
            "halogen",
            "tall-grass",
            "soon-enough",
            "nerve",
          ],
        },
      ],
      sessions: [
        {
          key: "halogen",
          track: "halogen",
          main: true,
          localPath:
            "/Users/ellis/Music/Ableton/Low Tide/Halogen Project/halogen long outro.als",
          home: "/Users/ellis",
          machine: "Ellis's MacBook Pro",
          savedAt: "2026-09-18T22:47:00+10:00",
          savedMessage: "Long outro, and the mix cleaned up for Tomas",
          history: [
            {
              at: "2026-05-09T20:40:00+10:00",
              tempo: 124,
              topLevel: ["61 DRUMS", "53 BASS"],
              returns: false,
              message: "Drum and bass sketch",
              saves: 6,
            },
            {
              at: "2026-05-23T19:10:00+10:00",
              tempo: 124,
              topLevel: ["61 DRUMS", "53 BASS", "15 SYNTHS"],
              returns: true,
              missingDevices: { "B-Shimmery Verb": ["ValhallaShimmer"] },
              message: "Synth layers, a shimmer return and the first low end",
              saves: 10,
            },
            {
              at: "2026-06-14T21:05:00+10:00",
              tempo: 128,
              topLevel: ["61 DRUMS", "53 BASS", "15 SYNTHS", "2 VOCALS"],
              returns: true,
              missingDevices: { "B-Shimmery Verb": ["ValhallaShimmer"] },
              message: "Vocal chops in, and the whole thing up to 128",
              saves: 12,
            },
            {
              at: "2026-07-19T16:30:00+10:00",
              tempo: 128,
              topLevel: [
                "1 SIDECHAINING",
                "2 VOCALS",
                "15 SYNTHS",
                "53 BASS",
                "61 DRUMS",
                "Fx",
              ],
              returns: true,
              missingDevices: { "1 SIDECHAINING": ["kHs Ring Mod"] },
              message: "Sidechain bus, an Fx group and the kick back on top",
              saves: 14,
            },
          ],
          comments: [
            {
              author: "tomas",
              text: "Seventy-seven tracks. Can you bounce the synth groups to stems before the mix session?",
              replies: [
                { author: "ellis", text: "On it, printing them tonight." },
              ],
            },
          ],
        },
      ],
      savedViews: [
        {
          owner: "ellis",
          name: "Mixing queue",
          kind: "track",
          sort: "priority.desc",
          filter: { status: "Mixing" },
          shared: true,
        },
        {
          owner: "ellis",
          name: "Singles",
          kind: "track",
          filter: { label: "single" },
          shared: true,
        },
        {
          owner: "ellis",
          name: "By status",
          kind: "track",
          group: "status",
          shared: false,
        },
        {
          owner: "tomas",
          name: "EP tracks",
          kind: "track",
          filter: { collection: "harbour-lights" },
          shared: true,
        },
      ],
    },
    {
      key: "glasshouse",
      name: "Glasshouse",
      owner: "priya",
      cover: "mono",
      description: [
        "Priya and Ellis, guitars and machines. A slow project with no deadline.",
      ],
      links: [],
      members: [
        { account: "ellis", role: "admin" },
        { account: "tomas", role: "editor" },
      ],
      invites: [{ email: "juno@example.com", role: "viewer" }],
      statuses: [],
      labels: [{ name: "instrumental", colourHex: "#94A3B8" }],
      tracks: [
        {
          key: "canopy",
          title: "Canopy",
          artists: ["Glasshouse"],
          status: "In Progress",
          priority: "medium",
          cover: "mono",
          labels: ["instrumental"],
          notes: ["Three passes at the arrangement. The quiet one won."],
          versions: [
            {
              file: "canopy-1.mp3",
              name: "canopy - take 3.mp3",
              durationMs: 240013,
              pins: [
                {
                  author: "priya",
                  atMs: 70000,
                  text: "Feedback swell starts here, let it ring.",
                },
                {
                  author: "priya",
                  atMs: 180000,
                  text: "Quiet and wide. This is the one.",
                  replies: [
                    {
                      author: "ellis",
                      text: "Agreed, the space is the point.",
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          key: "thin-walls",
          title: "Thin Walls",
          artists: ["Glasshouse"],
          status: "To Do",
          priority: "low",
          cover: "mono",
          labels: [],
          notes: ["Needs a middle section."],
          versions: [
            {
              file: "thin-walls-1.mp3",
              name: "thin walls - demo.mp3",
              durationMs: 235990,
              pins: [
                {
                  author: "ellis",
                  atMs: 95000,
                  text: "Middle section could go half time here.",
                },
              ],
            },
          ],
        },
      ],
      collections: [],
      sessions: [],
      savedViews: [],
    },
    {
      key: "sketchbook",
      name: "Sketchbook",
      owner: "ellis",
      cover: "sunset",
      description: [
        "Ideas before they are songs. Everything here is under two minutes and allowed to be bad.",
      ],
      links: [],
      members: [{ account: "tomas", role: "viewer" }],
      invites: [],
      statuses: [
        { name: "Sketch", colourHex: "#8A8A8A", percentage: 10 },
        { name: "Keeper", colourHex: "#4A7FD4", percentage: 40 },
      ],
      labels: [],
      tracks: [
        {
          key: "fizz",
          title: "Fizz",
          artists: ["Ellis Marr"],
          status: "Sketch",
          priority: "none",
          labels: [],
          notes: [],
          versions: [
            {
              file: "fizz-1.mp3",
              name: "fizz idea.mp3",
              durationMs: 64340,
              pins: [],
            },
          ],
        },
        {
          key: "quiet-hours",
          title: "Quiet Hours",
          artists: ["Ellis Marr"],
          status: "Sketch",
          priority: "low",
          labels: [],
          notes: [],
          versions: [
            {
              file: "quiet-hours-1.mp3",
              name: "quiet hours.mp3",
              durationMs: 35213,
              pins: [],
            },
          ],
        },
        {
          key: "loose-thread",
          title: "Loose Thread",
          artists: ["Ellis Marr"],
          status: "Keeper",
          priority: "medium",
          labels: [],
          notes: ["Grew out of Quiet Hours."],
          versions: [
            {
              file: "loose-thread-1.mp3",
              name: "loose thread - ok this one is actually going somewhere.mp3",
              durationMs: 70792,
              pins: [],
            },
          ],
          relations: [{ to: "quiet-hours", relation: "rework" }],
        },
        {
          key: "mirror-hall",
          title: "Mirror Hall (remix)",
          artists: ["Ellis Marr"],
          status: "Sketch",
          priority: "low",
          labels: [],
          notes: [],
          versions: [
            {
              file: "mirror-hall-1.mp3",
              name: "mirror hall remix.mp3",
              durationMs: 67344,
              pins: [],
            },
          ],
        },
        {
          key: "small-mercy",
          title: "Small Mercy",
          artists: ["Ellis Marr"],
          status: "Keeper",
          priority: "medium",
          labels: [],
          notes: [],
          versions: [
            {
              file: "small-mercy-1.mp3",
              name: "small mercy - new one, keeping this.mp3",
              durationMs: 57913,
              pins: [],
            },
          ],
        },
      ],
      collections: [],
      sessions: [],
      savedViews: [],
    },
  ],

  shareLinks: [
    {
      project: "low-tide",
      owner: "ellis",
      entity: { kind: "collection", key: "harbour-lights" },
      type: "snapshot",
      description:
        "Harbour Lights, the masters as they stand. Thanks for listening.",
      guestComments: [
        {
          name: "Noor",
          track: "slow-parade",
          atMs: 74000,
          text: "The way it drops back into the chorus here is gorgeous. Is this the final master?",
        },
      ],
    },
  ],

  notes: [
    {
      author: "ellis",
      pinned: true,
      body: [
        "# Harbour Lights checklist",
        "Masters to Tomás by 10 October.",
        "Artwork final: sunset cover, no text on the front.",
        "Slow Parade goes out first, two weeks before the EP.",
        "Book the listening party for the Thursday after release.",
      ],
    },
    {
      author: "ellis",
      body: [
        "# Mix notes for Halogen",
        "Vocal chops before arps in the drop.",
        "Keep the long outro, lose the second riser.",
        "Check the sub on the club system before signing off.",
      ],
    },
    {
      author: "juno",
      body: [
        "# Words for Soon Enough",
        "harbour, arbour, calmer",
        "the tide takes the long way round",
        "a porch light left on for the feeling",
      ],
    },
  ],
};
