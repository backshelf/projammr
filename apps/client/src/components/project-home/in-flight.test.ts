import { describe, expect, it } from "bun:test";
import type { Job, JobStatus } from "@workspace/api/api";

import { inFlightCount, inFlightJobs } from "./in-flight";

const job = (id: number, status: JobStatus) => ({ id, status }) as Job;

describe("inFlightJobs", () => {
  it("keeps running and queued jobs in the order given", () => {
    const jobs = [job(1, "queued"), job(2, "running"), job(3, "queued")];

    expect(inFlightJobs(jobs).map((j) => j.id)).toEqual([1, 2, 3]);
  });

  it("drops lingering and failed jobs", () => {
    const jobs = [
      job(1, "done"),
      job(2, "running"),
      job(3, "cancelled"),
      job(4, "failed"),
    ];

    expect(inFlightJobs(jobs).map((j) => j.id)).toEqual([2]);
  });

  it("returns nothing for nothing", () => {
    expect(inFlightJobs([])).toEqual([]);
  });
});

describe("inFlightCount", () => {
  it("reads running then queued", () => {
    const jobs = [job(1, "running"), job(2, "queued"), job(3, "running")];

    expect(inFlightCount(jobs)).toBe("2 running · 1 queued");
  });

  it("drops the queued clause at zero", () => {
    expect(inFlightCount([job(1, "running")])).toBe("1 running");
  });

  it("drops the running clause at zero", () => {
    const jobs = [job(1, "queued"), job(2, "queued"), job(3, "queued")];

    expect(inFlightCount(jobs)).toBe("3 queued");
  });
});
