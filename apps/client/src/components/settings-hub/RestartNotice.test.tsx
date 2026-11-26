import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ReactNode } from "react";

mock.module("@/lib/browser-api", () => ({
  browserApi: { GET: mock(), PATCH: mock(), PUT: mock() },
}));

const { SettingsProvider } = await import("@/lib/settings/provider");
const { effectiveSettings } = await import("@/lib/settings/effective");
const { HubRowsProvider } = await import("./hub-rows");
const { RestartNotice } = await import("./RestartNotice");
type HubRows = import("./types").HubRows;
type HubRow = import("./types").HubRow;

const SESSION = "instance-access.sessionLifetimeDays";
const MCP = "instance-integrations.mcpEnabled";
const KEYS = [SESSION, MCP] as const;

const running = (effective: unknown, runningValue: unknown): HubRow => ({
  effective,
  running: runningValue,
  source: "instance",
  writable: { instance: true },
  lockable: { instance: true },
  values: { instance: effective },
});

const page = (rows: HubRows): ReactNode => (
  <SettingsProvider initial={effectiveSettings({}, "v1")}>
    <HubRowsProvider initial={rows} projectId={null} userId="u1">
      <RestartNotice keys={KEYS} />
    </HubRowsProvider>
  </SettingsProvider>
);

/** Whether the notice shows. */
const open = () => screen.queryByRole("status") !== null;

afterEach(cleanup);

describe("RestartNotice", () => {
  it("says nothing while the server runs with every value", () => {
    render(page({ [SESSION]: running(7, 7), [MCP]: running(true, true) }));

    expect(open()).toBe(false);
    expect(screen.queryByText(/wait/)).toBeNull();
  });

  it("names the one setting that differs from the running value", () => {
    render(page({ [SESSION]: running(30, 7), [MCP]: running(true, true) }));

    expect(open()).toBe(true);
    expect(screen.getByRole("status").textContent).toBe(
      "A setting waits for the server to restart: Stay signed in for. Until then it runs with the values it started with."
    );
  });

  it("is one notice for every setting waiting, and goes once they match again", () => {
    const { rerender } = render(
      page({ [SESSION]: running(30, 7), [MCP]: running(false, true) })
    );

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain(
      "2 settings wait for the server to restart: Stay signed in for, MCP server."
    );

    rerender(page({ [SESSION]: running(7, 7), [MCP]: running(true, true) }));

    expect(open()).toBe(false);
  });
});
