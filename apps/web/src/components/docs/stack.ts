/**
 * The compose stack as the self-hosting docs draw it: the services, the
 * proxy's routes and the volumes, taken from `docker-compose.yml`, the
 * `Caddyfile` and the `Dockerfile`. `test/stack.test.ts` holds this against
 * those files, so the diagram fails the gates rather than drifting.
 */

export type ServiceName = "proxy" | "web" | "api" | "db" | "backup";

/** One service in `docker-compose.yml`. */
export type StackService = {
  name: ServiceName;
  /** What runs in it. */
  runs: string;
  /** The port it listens on inside the compose network. */
  port: number | null;
  /** Its `ports:` entries: what the host publishes. Empty for a service only the network can reach. */
  published: string[];
  /** What its health check asks, from the compose file or the image. */
  health: string | null;
  /** The service whose health it waits for before starting (`depends_on`). */
  after: ServiceName | null;
  /** The compose profile it belongs to; a profiled service never starts with a plain `up`. */
  profile: string | null;
};

export const SERVICES: Record<ServiceName, StackService> = {
  proxy: {
    name: "proxy",
    runs: "Caddy, with its own local CA",
    port: null,
    published: ["80:80", "443:443", "443:443/udp"],
    health: null,
    after: "web",
    profile: null,
  },
  web: {
    name: "web",
    runs: "The Next.js web app, on Bun",
    port: 3000,
    published: [],
    health: "/api/health through its own rewrite",
    after: "api",
    profile: null,
  },
  api: {
    name: "api",
    runs: "The Hono API on Bun, with ffmpeg",
    port: 8080,
    published: [],
    health: "/api/health, 503 until the database answers",
    after: "db",
    profile: null,
  },
  db: {
    name: "db",
    runs: "PostgreSQL 17",
    port: 5432,
    published: [],
    health: "pg_isready",
    after: null,
    profile: null,
  },
  backup: {
    name: "backup",
    runs: "pg_dump and tar, once, then exits",
    port: null,
    published: [],
    health: null,
    after: "db",
    profile: "backup",
  },
};

/** Where the proxy sends a request, by scheme and path, in the Caddyfile's order. */
export type ProxyRoute = {
  scheme: "http" | "https";
  /** The Caddyfile matcher, or null for the site's fallback `handle`. */
  path: string | null;
  /** The service it is proxied to, or null when Caddy answers it itself. */
  service: ServiceName | null;
  to: string;
};

export const ROUTES: ProxyRoute[] = [
  {
    scheme: "http",
    path: "/ca.crt",
    service: null,
    to: "the local CA's root certificate",
  },
  {
    scheme: "http",
    path: null,
    service: null,
    to: "a 308 redirect to HTTPS",
  },
  { scheme: "https", path: "/api/*", service: "api", to: "api" },
  {
    scheme: "https",
    path: "/media/*",
    service: "api",
    to: "api, as /static/*",
  },
  { scheme: "https", path: null, service: "web", to: "web" },
];

/** A named volume in `docker-compose.yml`. */
export type StackVolume = {
  name: string;
  /** What it keeps. */
  holds: string;
  /** Each service that mounts it, and whether read-only. */
  mounts: { service: ServiceName; readOnly: boolean }[];
};

export const VOLUMES: StackVolume[] = [
  {
    name: "db-data",
    holds: "The database",
    mounts: [{ service: "db", readOnly: false }],
  },
  {
    name: "static-data",
    holds: "Uploaded audio and images, and their analysis",
    mounts: [
      { service: "api", readOnly: false },
      { service: "backup", readOnly: true },
    ],
  },
  {
    name: "backups-data",
    holds: "Pre-migrate and manual database dumps, media archives",
    mounts: [
      { service: "api", readOnly: false },
      { service: "backup", readOnly: false },
    ],
  },
  {
    name: "caddy-data",
    holds: "The local CA and the certificates it signs",
    mounts: [{ service: "proxy", readOnly: false }],
  },
  {
    name: "caddy-config",
    holds: "Caddy's own saved configuration",
    mounts: [{ service: "proxy", readOnly: false }],
  },
];
