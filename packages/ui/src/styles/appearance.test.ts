import {
  APPEARANCE,
  ART_FALLBACK_PROPERTY,
  type AppearanceKey,
} from "@workspace/ui/lib/appearance";
import { ACCENT_TONES, artVarsFromAccent } from "@workspace/ui/lib/art";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One block of a stylesheet: its prelude (a selector or an at-rule), the
 *  preludes it is nested in, outermost first, and its own declarations. */
type Block = {
  prelude: string;
  context: string[];
  declarations: Record<string, string>;
};

/**
 * Reads the blocks out of one of the token layer's own files. The files are
 * hand-written and hold no braces or semicolons inside strings other than
 * quoted `url()`s, so a brace-and-semicolon walk that skips comments and
 * quoted strings is all the parsing they need.
 */
function parse(css: string): Block[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: Block[] = [];
  const stack: Block[] = [];
  let buffer = "";
  let quote: string | null = null;
  let depth = 0;

  const declare = (text: string) => {
    const statement = text.trim();
    const top = stack.at(-1);
    if (!statement || !top || statement.startsWith("@")) return;
    const colon = statement.indexOf(":");
    if (colon < 0) return;
    top.declarations[statement.slice(0, colon).trim()] = statement
      .slice(colon + 1)
      .replace(/\s+/g, " ")
      .trim();
  };

  for (const char of source) {
    if (quote) {
      buffer += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      buffer += char;
    } else if (char === "(") {
      depth++;
      buffer += char;
    } else if (char === ")") {
      depth--;
      buffer += char;
    } else if (char === ";" && depth === 0) {
      declare(buffer);
      buffer = "";
    } else if (char === "{" && depth === 0) {
      const block: Block = {
        prelude: buffer.replace(/\s+/g, " ").trim(),
        context: stack.map((b) => b.prelude),
        declarations: {},
      };
      blocks.push(block);
      stack.push(block);
      buffer = "";
    } else if (char === "}" && depth === 0) {
      declare(buffer);
      buffer = "";
      stack.pop();
    } else {
      buffer += char;
    }
  }
  return blocks;
}

const STYLES = ["foundation.css", "atmosphere.css", "doc.css", "motion.css"];
const files = Object.fromEntries(
  STYLES.map((name) => [
    name,
    parse(readFileSync(join(import.meta.dir, name), "utf8")),
  ])
);
const all = Object.values(files).flat();

const selectorOf = (block: Block) =>
  [...block.context, block.prelude].join(" ");

/** Every block a selector names `[data-…="value"]` in, nested blocks
 *  included, with the declarations it (or a block inside it) carries. */
function rulesFor(key: AppearanceKey, value: string) {
  const needle = `[${APPEARANCE[key].attribute}="${value}"]`;
  return all.filter(
    (block) =>
      selectorOf(block).includes(needle) &&
      Object.keys(block.declarations).length > 0
  );
}

/** A top-level rule's declaration, outside any at-rule. */
function token(file: string, selector: string, name: string) {
  const block = files[file]!.find(
    (b) =>
      b.prelude === selector && b.context.length === 0 && name in b.declarations
  );
  return block?.declarations[name];
}

describe("the appearance attributes", () => {
  const entries = Object.entries(APPEARANCE) as [
    AppearanceKey,
    (typeof APPEARANCE)[AppearanceKey],
  ][];

  for (const [key, entry] of entries) {
    for (const value of entry.values) {
      if (value === entry.default) {
        it(`${entry.attribute}="${value}" is the default and has no rule of its own`, () => {
          expect(rulesFor(key, value)).toEqual([]);
        });
      } else {
        it(`${entry.attribute}="${value}" has a rule`, () => {
          expect(rulesFor(key, value).length).toBeGreaterThan(0);
        });
      }
    }
  }

  it("names no value outside the contract", () => {
    const attributes = new Map<string, AppearanceKey>(
      entries.map(([key, entry]) => [entry.attribute, key])
    );
    for (const block of all) {
      for (const [, attribute = "", value = ""] of selectorOf(block).matchAll(
        /\[(data-[a-z]+)="([^"]*)"\]/g
      )) {
        const key = attributes.get(attribute);
        if (!key) continue;
        expect(
          APPEARANCE[key].values as readonly string[],
          selectorOf(block)
        ).toContain(value);
      }
    }
  });

  it("reads every attribute off <html>", () => {
    const names = entries.map(([, entry]) => entry.attribute);
    for (const block of all) {
      const selector = selectorOf(block);
      if (!names.some((name) => selector.includes(`[${name}=`))) continue;
      expect(selector, selector).toMatch(/:root/);
    }
  });
});

describe("the token layer with no attribute", () => {
  it.each([
    ["foundation.css", ":root", "--t-micro", "0.6875rem"],
    ["foundation.css", ":root", "--t-small", "0.75rem"],
    ["foundation.css", ":root", "--t-body", "0.875rem"],
    ["foundation.css", ":root", "--t-lead", "1rem"],
    ["foundation.css", ":root", "--t-section", "1.5rem"],
    ["foundation.css", ":root", "--t-subtitle", "1.75rem"],
    ["foundation.css", ":root", "--t-title", "2.5rem"],
    ["foundation.css", ":root", "--t-display", "clamp(2.5rem, 6.5vw, 5.5rem)"],
    ["foundation.css", ":root", "--measure", "68ch"],
    ["foundation.css", ":root", "--column", "52rem"],
    ["foundation.css", ":root", "--gutter", "clamp(1rem, 3vw, 2.5rem)"],
    ["foundation.css", ":root", "--radius", "0.45rem"],
    ["foundation.css", ":root", "--grain-opacity", "0.5"],
    ["foundation.css", ".dark", "--grain-opacity", "0.75"],
    ["foundation.css", ":root", "--density", "1"],
    [
      "foundation.css",
      ":root",
      "--table-row-h",
      "round(calc(2.75rem * var(--density)), 1px)",
    ],
    ["foundation.css", ":root", "--masthead-band", "82vh"],
    ["foundation.css", ":root", "--masthead-head", "50vh"],
    ["foundation.css", ":root", "--font-body", "var(--font-mono)"],
    ["motion.css", ".masthead__art", "--art-blur", "64px"],
    ["motion.css", ".masthead__art", "--art-sat-mid", "1.7"],
    ["motion.css", ".masthead__art", "--art-opacity", "0.85"],
    ["motion.css", ".dark .masthead__art", "--art-opacity", "0.7"],
    ["atmosphere.css", ".wash", "--key-a", "0.58"],
    ["atmosphere.css", ".wash", "--lobe-a", "0.3"],
    ["doc.css", ".doc", "line-height", "1.75"],
  ])("keeps %s %s %s at %s", (file, selector, name, value) => {
    expect(token(file, selector, name)).toBe(value);
  });

  it("keeps the phone tier's masthead at today's heights", () => {
    const phone = files["foundation.css"]!.find(
      (b) =>
        b.prelude === ":root" &&
        b.context.join() === "@media (width < 768px)" &&
        "--masthead-band" in b.declarations
    );
    expect(phone?.declarations).toEqual({
      "--masthead-band": "52vh",
      "--masthead-head": "30vh",
    });
  });
});

describe("grain", () => {
  it("halves each theme's strength at subtle", () => {
    const light = Number(token("foundation.css", ":root", "--grain-opacity"));
    const dark = Number(token("foundation.css", ".dark", "--grain-opacity"));
    const subtle = rulesFor("grain", "subtle");
    const at = (selector: string) =>
      Number(
        subtle.find((b) => b.prelude === selector)?.declarations[
          "--grain-opacity"
        ]
      );
    expect(at(':root[data-grain="subtle"]')).toBe(light / 2);
    expect(at(':root.dark[data-grain="subtle"]')).toBe(dark / 2);
  });

  it("takes the layer away at off", () => {
    const off = rulesFor("grain", "off").find((b) =>
      b.prelude.endsWith("body::after")
    );
    expect(off?.declarations.content).toBe("none");
  });
});

describe("glow and ambient motion", () => {
  it("hides the wash and the art field at glow off", () => {
    const off = rulesFor("glow", "off")[0]!;
    expect(off.prelude).toContain(".wash");
    expect(off.prelude).toContain(".masthead__art");
    expect(off.declarations.display).toBe("none");
  });

  it("stops the three ambient loops at ambient off, and nothing else", () => {
    const off = rulesFor("ambient", "off")[0]!;
    const stopped = [...off.prelude.matchAll(/\.([a-z_-]+)/g)].map((m) => m[1]);
    expect(stopped.sort()).toEqual(
      ["masthead__field", "wash__lobe--deep", "wash__lobe--lift"].sort()
    );
    expect(off.declarations.animation).toBe("none");
    for (const name of stopped) {
      const loop = all.find(
        (b) =>
          b.prelude === `.${name}` &&
          b.context.length === 0 &&
          b.declarations.animation?.includes("infinite")
      );
      expect(loop, name).toBeDefined();
    }
  });

  it("keeps .masthead__tone on a static filter with no keyframe animation", () => {
    const motion = files["motion.css"]!;
    expect(token("motion.css", ".masthead__tone", "filter")).toBe(
      "blur(var(--art-blur)) saturate(var(--art-sat-mid))"
    );
    expect(
      motion.some(
        (b) =>
          b.prelude === "@keyframes art-tone" || b.prelude.includes("art-tone")
      )
    ).toBe(false);
    expect(
      motion.some(
        (b) =>
          b.prelude.includes(".masthead__tone") && "animation" in b.declarations
      )
    ).toBe(false);
    expect(
      motion.some(
        (b) =>
          "--art-sat-low" in b.declarations ||
          "--art-sat-high" in b.declarations
      )
    ).toBe(false);
  });
});

describe("contrast floor", () => {
  const achromaticLuminance = (value: string | undefined) => {
    const match = value?.match(/^oklch\(([\d.]+)\s+0\s+0\)$/);
    expect(match, value).not.toBeNull();
    const L = Number(match![1]);
    return L * L * L;
  };
  const contrastRatio = (a: number, b: number) =>
    (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  it.each([
    ["light", ":root"],
    ["dark", ".dark"],
  ])(
    "holds --ink-faint at WCAG AA (>= 4.5:1) against --paper and --paper-sunk in %s mode",
    (_label, selector) => {
      const faint = achromaticLuminance(
        token("foundation.css", selector, "--ink-faint")
      );
      const paper = achromaticLuminance(
        token("foundation.css", selector, "--paper")
      );
      const paperSunk = achromaticLuminance(
        token("foundation.css", selector, "--paper-sunk")
      );
      expect(contrastRatio(faint, paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(faint, paperSunk)).toBeGreaterThanOrEqual(4.5);
    }
  );

  it("holds .on-art-soft at WCAG AA (>= 4.5:1) across masthead scrim dips in both themes", () => {
    const color = token("atmosphere.css", ".on-art-soft", "color");
    const match = color?.match(
      /^color-mix\(in oklab, var\(--ink\) ([\d.]+)%, transparent\)$/
    );
    expect(match, color).not.toBeNull();
    const alpha = Number(match![1]) / 100;
    const enc = (c: number) =>
      c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    const dec = (c: number) =>
      c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    const over = (fg: number, a: number, bg: number) => a * fg + (1 - a) * bg;

    const cases = [
      { selector: ":root", coverL: 0.25, artAlpha: 0.85, scrimDip: 0.34 },
      { selector: ".dark", coverL: 0.85, artAlpha: 0.7, scrimDip: 0.3 },
    ];
    for (const { selector, coverL, artAlpha, scrimDip } of cases) {
      const paperS = enc(
        achromaticLuminance(token("foundation.css", selector, "--paper"))
      );
      const inkS = enc(
        achromaticLuminance(token("foundation.css", selector, "--ink"))
      );
      const coverS = enc(coverL ** 3);
      const bgS = over(paperS, scrimDip, over(coverS, artAlpha, paperS));
      const bgLin = dec(bgS);
      const fgLin = dec(over(inkS, alpha, bgS));
      expect(contrastRatio(fgLin, bgLin), selector).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("density", () => {
  const factor = (value: string) =>
    Number(rulesFor("density", value)[0]?.declarations["--density"]);

  it("tightens below the default and opens up above it", () => {
    expect(factor("compact")).toBeLessThan(1);
    expect(factor("spacious")).toBeGreaterThan(1);
  });
});

describe("text size", () => {
  const SCALE = [
    "--t-micro",
    "--t-small",
    "--t-body",
    "--t-lead",
    "--t-section",
    "--t-subtitle",
    "--t-title",
    "--t-display",
  ];
  const rem = (value: string | undefined) => Number(value?.replace("rem", ""));
  const scaleOf = (value: string) =>
    rulesFor("text", value).find((b) => "--t-body" in b.declarations)!
      .declarations;

  it.each(["sm", "lg", "xl"])("sets every step of the scale at %s", (value) => {
    expect(Object.keys(scaleOf(value)).sort()).toEqual([...SCALE].sort());
  });

  it.each(["sm", "lg", "xl"])("keeps the hierarchy in order at %s", (value) => {
    const scale = scaleOf(value);
    const steps = SCALE.slice(0, -1).map((name) => rem(scale[name]));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(new Set(steps.slice(1)).size).toBe(steps.length - 1);
  });

  it("never sets the micro step below the default's floor", () => {
    const floor = rem(token("foundation.css", ":root", "--t-micro"));
    for (const value of ["sm", "lg", "xl"])
      expect(rem(scaleOf(value)["--t-micro"])).toBeGreaterThanOrEqual(floor);
  });

  it("orders the body sizes sm < md < lg < xl", () => {
    const md = rem(token("foundation.css", ":root", "--t-body"));
    const body = ["sm", "lg", "xl"].map((v) => rem(scaleOf(v)["--t-body"]));
    expect([body[0], md, body[1], body[2]]).toEqual(
      [body[0]!, md, body[1]!, body[2]!].sort((a, b) => a - b)
    );
  });

  it("points Tailwind's stock steps at the scale whenever the size moves", () => {
    const stock = rulesFor("text", "lg").find(
      (b) => "--text-sm" in b.declarations
    )!.declarations;
    expect(stock).toEqual({
      "--text-xs": "var(--t-small)",
      "--text-sm": "var(--t-body)",
      "--text-base": "var(--t-lead)",
    });
    for (const value of ["sm", "xl"])
      expect(
        rulesFor("text", value).some((b) => "--text-sm" in b.declarations)
      ).toBe(true);
  });
});

describe("reduced motion", () => {
  const REDUCE = "@media (prefers-reduced-motion: reduce)";

  it("lets data-motion decide every rule the OS preference reaches", () => {
    for (const block of all) {
      if (!block.context.includes(REDUCE) && block.prelude !== REDUCE) continue;
      if (block.context.some((c) => c.startsWith("@custom-variant"))) continue;
      if (block.prelude === REDUCE) continue;
      expect(selectorOf(block), selectorOf(block)).toContain(
        ':root:not([data-motion="full"])'
      );
    }
  });

  it("gives every hand-written OS rule its data-motion=reduce twin", () => {
    const OS = ':where(:root:not([data-motion="full"]))';
    const FORCED = ':where(:root[data-motion="reduce"])';
    const os = all.filter(
      (b) => b.context.includes(REDUCE) && b.prelude.startsWith(OS)
    );
    expect(os.length).toBeGreaterThan(0);
    for (const block of os) {
      const twin = all.find(
        (b) =>
          b.context.length === 0 &&
          b.prelude === block.prelude.replaceAll(OS, FORCED)
      );
      expect(twin?.declarations, block.prelude).toEqual(block.declarations);
    }
  });
});

describe("the accent fallback", () => {
  const foundation = files["foundation.css"]!;
  const carrier = `[style*="${ART_FALLBACK_PROPERTY}:"]`;
  const fallback = foundation.find(
    (b) => b.prelude === carrier && b.context.length === 0
  )!;
  const derivation = foundation.find(
    (b) =>
      b.prelude === carrier &&
      b.context.includes("@supports (color: oklch(from white l c h))")
  )!;
  const TOKENS = {
    art: "--art-fallback-light",
    glow: "--art-fallback-glow-light",
    artDark: "--art-fallback-dark",
    glowDark: "--art-fallback-glow-dark",
  } as const;

  it.each(Object.entries(TOKENS) as [keyof typeof TOKENS, string][])(
    "makes %s from the same lightness and chroma cap as a cover's accent inside @supports",
    (role, name) => {
      const match = derivation.declarations[name]?.match(
        /^oklch\( ?from var\(--art-fallback\) ([\d.]+) min\(c(?: \* ([\d.]+))?, ([\d.]+)\) h ?\)$/
      );
      expect(match, derivation.declarations[name]).not.toBeNull();
      const [, lightness, scale = "1", max] = match!;
      expect({
        lightness: Number(lightness),
        chromaScale: Number(scale),
        maxChroma: Number(max),
      }).toEqual(ACCENT_TONES[role]);
    }
  );

  it("replaces the grayscale accent on the element that carries it", () => {
    expect(fallback.declarations["--art"]).toBe(`var(${TOKENS.art})`);
    expect(fallback.declarations["--art-glow"]).toBe(`var(${TOKENS.glow})`);
    const dark = foundation.find((b) =>
      b.prelude.startsWith(`.dark${carrier}`)
    )!;
    expect(dark.declarations["--art"]).toBe(`var(${TOKENS.artDark})`);
    expect(dark.declarations["--art-glow"]).toBe(`var(${TOKENS.glowDark})`);
  });

  it("gives way to a cover's inline pair, which resolves after it", () => {
    const at = (prelude: string) =>
      foundation.findIndex((b) => b.prelude.startsWith(prelude));
    expect(at(carrier)).toBeLessThan(at('[style*="--art-light"]'));
    expect(at(`.dark${carrier}`)).toBeLessThan(
      at('.dark [style*="--art-dark"]')
    );
  });

  it("reaches a grayscale artwork pair, whose own greys are the page's", () => {
    const grey = artVarsFromAccent(null, null);
    const page = (selector: string, name: string) =>
      token("foundation.css", selector, name);
    expect(grey["--art-light"]).toBe(
      `var(${TOKENS.art}, ${page(":root", "--art")})`
    );
    expect(grey["--art-glow-light"]).toBe(
      `var(${TOKENS.glow}, ${page(":root", "--art-glow")})`
    );
    expect(grey["--art-dark"]).toBe(
      `var(${TOKENS.artDark}, ${page(".dark", "--art")})`
    );
    expect(grey["--art-glow-dark"]).toBe(
      `var(${TOKENS.glowDark}, ${page(".dark", "--art-glow")})`
    );
  });

  it("matches the property, never a value that names one of its tokens", () => {
    const style = Object.entries(artVarsFromAccent(null, null))
      .map(([name, value]) => `${name}:${value}`)
      .join(";");
    expect(style).toContain(ART_FALLBACK_PROPERTY);
    expect(style).not.toContain(`${ART_FALLBACK_PROPERTY}:`);
  });
});

describe("the lyrics gutter off-rules", () => {
  const offRule = (attribute: string) =>
    files["doc.css"]!.find((b) => b.prelude.includes(`[${attribute}="off"]`))!;

  it("keeps the syllable column's box when syllables are off", () => {
    const rule = offRule("data-lyrics-syllables");
    expect(rule.prelude).toContain("::before");
    expect(rule.declarations.content).toBe('""');
  });

  it("leaves the empty-document placeholder alone when rhymes are off", () => {
    const rule = offRule("data-lyrics-rhymes");
    expect(rule.prelude).toContain("::after");
    expect(rule.prelude).toContain(":not( [data-is-only-empty-block] )");
    expect(rule.declarations.content).toBe("none !important");
  });
});

describe("prose, noise and keyboard dock", () => {
  it('sets .doc default prose to system sans while respecting :root[data-font="serif"]', () => {
    expect(token("doc.css", ".doc", "--font-doc")).toBe(
      "var(--font-system-sans)"
    );
    expect(token("doc.css", ".doc", "font-family")).toBe("var(--font-doc)");
    expect(
      token("doc.css", ':root[data-font="serif"] .doc', "--font-doc")
    ).toBe("var(--font-system-serif)");
    expect(token("doc.css", ".doc code", "border")).toBe(
      "1px solid var(--rule)"
    );
    expect(token("doc.css", ".doc a", "color")).toBe("var(--art)");
  });

  it("replaces SVG feTurbulence with pre-baked PNG noise in atmosphere.css", () => {
    const atmosphere = readFileSync(
      join(import.meta.dir, "atmosphere.css"),
      "utf8"
    );
    expect(atmosphere).not.toContain("feTurbulence");
    expect(token("atmosphere.css", ".wash", "mask-image")).toContain(
      "data:image/png;base64,"
    );
    expect(
      token("atmosphere.css", "body::after", "background-image")
    ).toContain("data:image/png;base64,");
  });

  it("zeroes --dock when body[data-keyboard] is active on phones", () => {
    const keyboard = files["foundation.css"]!.find(
      (b) =>
        b.prelude === "body[data-keyboard]" &&
        b.context.join() === "@media (width < 768px)"
    );
    expect(keyboard?.declarations["--dock"]).toBe("0px");
  });
});
