import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import {
  ROUTES,
  type ServiceName,
  SERVICES,
  VOLUMES,
} from "../src/components/docs/stack";

const root = join(import.meta.dir, "..", "..", "..");
const read = (file: string) => Bun.file(join(root, file)).text();

type ComposeService = {
  ports?: string[];
  depends_on?: Record<string, unknown>;
  profiles?: string[];
  volumes?: string[];
  environment?: Record<string, string | null>;
};
type ComposeFile = {
  services: Record<string, ComposeService>;
  volumes: Record<string, unknown>;
};

const compose = async () =>
  Bun.YAML.parse(await read("docker-compose.yml")) as ComposeFile;

const names = Object.keys(SERVICES) as ServiceName[];

describe("the stack diagram against docker-compose.yml", () => {
  it("draws every service compose defines, and no other", async () => {
    const { services } = await compose();
    expect(Object.keys(services).sort()).toEqual([...names].sort());
  });

  it("publishes exactly the ports compose publishes", async () => {
    const { services } = await compose();
    for (const name of names) {
      expect(SERVICES[name].published, name).toEqual(
        services[name]?.ports ?? []
      );
    }
  });

  it("starts each service after the one compose makes it wait for", async () => {
    const { services } = await compose();
    for (const name of names) {
      const after = SERVICES[name].after;
      expect(Object.keys(services[name]?.depends_on ?? {}), name).toEqual(
        after ? [after] : []
      );
    }
  });

  it("puts each service in the profile compose gives it", async () => {
    const { services } = await compose();
    for (const name of names) {
      const profile = SERVICES[name].profile;
      expect(services[name]?.profiles ?? [], name).toEqual(
        profile ? [profile] : []
      );
    }
  });

  it("mounts each named volume where compose mounts it", async () => {
    const file = await compose();
    expect(VOLUMES.map((volume) => volume.name).sort()).toEqual(
      Object.keys(file.volumes).sort()
    );

    const mounted = names.flatMap((service) =>
      (file.services[service]?.volumes ?? [])
        .filter((entry) => !entry.startsWith("."))
        .map((entry) => {
          const [volume, , mode] = entry.split(":");
          return `${volume} ${service} ${mode === "ro"}`;
        })
    );
    const drawn = VOLUMES.flatMap((volume) =>
      volume.mounts.map(
        (mount) => `${volume.name} ${mount.service} ${mount.readOnly}`
      )
    );
    expect(drawn.sort()).toEqual(mounted.sort());
  });

  it("reaches the database on the port the API's DATABASE_URL names", async () => {
    const { services } = await compose();
    expect(services.api?.environment?.DATABASE_URL).toContain(
      `@db:${SERVICES.db.port}/`
    );
  });
});

describe("the stack diagram against the Caddyfile and the Dockerfile", () => {
  it("routes each path the Caddyfile handles", async () => {
    const caddyfile = await read("Caddyfile");
    for (const route of ROUTES) {
      if (route.path) {
        expect(caddyfile).toMatch(
          new RegExp(`handle(_path)? ${route.path.replace("*", "\\*")} \\{`)
        );
      }
    }
    expect(caddyfile).toContain("rewrite * /static{uri}");
    expect(caddyfile).toContain("redir https://{host}{uri} 308");
  });

  it("sends the API and the web app to the ports their images expose", async () => {
    const [caddyfile, dockerfile] = await Promise.all([
      read("Caddyfile"),
      read("Dockerfile"),
    ]);
    for (const name of ["api", "web"] as const) {
      const port = SERVICES[name].port;
      expect(caddyfile).toContain(`reverse_proxy ${name}:${port}`);
      expect(dockerfile).toContain(`EXPOSE ${port}`);
    }
  });
});

type ServeConfig = {
  Web: Record<string, { Handlers: Record<string, { Proxy: string }> }>;
};

describe("the Tailscale serve config against the diagram's HTTPS routes", () => {
  it("proxies each path the Caddyfile's HTTPS site routes, to the same service", async () => {
    const config = JSON.parse(
      await read("tailscale-serve.json")
    ) as ServeConfig;
    const sites = Object.values(config.Web);
    expect(sites).toHaveLength(1);
    const handlers = sites[0]!.Handlers;

    // A serve mount has no trailing wildcard; the site's fallback is `/`.
    const mount = (path: string | null) => path?.replace(/\/\*$/, "") ?? "/";
    const https = ROUTES.filter((route) => route.scheme === "https");
    expect(Object.keys(handlers).sort()).toEqual(
      https.map((route) => mount(route.path)).sort()
    );
    for (const route of https) {
      const service = route.service as ServiceName;
      expect(handlers[mount(route.path)]?.Proxy, mount(route.path)).toStartWith(
        `http://${service}:${SERVICES[service].port}`
      );
    }

    // Serve strips the mount and appends the rest to the target's path.
    expect(handlers["/api"]?.Proxy).toBe(`http://api:${SERVICES.api.port}/api`);
    expect(handlers["/media"]?.Proxy).toBe(
      `http://api:${SERVICES.api.port}/static`
    );
  });
});
