import { describe, expect, it } from "bun:test";
import {
  COLLECTION_FILTER_PARAMS,
  SESSION_FILTER_PARAMS,
  TRACK_FILTER_PARAMS,
} from "@workspace/api/lib/enums";

import {
  FILTER_PARAM_NAMES,
  filterViewQuery,
  parsePageParam,
  parseTableQuery,
  withFilters,
} from "./table-params";

describe("the filter list", () => {
  it("holds every filter a listing declares, Explicit among them", () => {
    const declared = [
      ...TRACK_FILTER_PARAMS,
      ...COLLECTION_FILTER_PARAMS,
      ...SESSION_FILTER_PARAMS,
    ];
    for (const param of declared) expect(FILTER_PARAM_NAMES).toContain(param);
    expect(FILTER_PARAM_NAMES).toContain("explicit");
  });

  it("reads the Explicit filter from the URL for the page loader", () => {
    expect(parseTableQuery({ explicit: "true" }).explicit).toBe("true");
    expect(parseTableQuery({ explicit: "false" }).explicit).toBe("false");
  });

  it("drops an Explicit value the server would refuse", () => {
    expect(parseTableQuery({ explicit: "maybe" }).explicit).toBeUndefined();
  });

  it("reads the unassigned filter from the URL and drops invalid values", () => {
    expect(parseTableQuery({ unassigned: "true" }).unassigned).toBe("true");
    expect(parseTableQuery({ unassigned: "false" }).unassigned).toBe("false");
    expect(
      parseTableQuery({ unassigned: "sometimes" }).unassigned
    ).toBeUndefined();
  });

  it("keeps the Explicit filter when a view is saved", () => {
    expect(filterViewQuery("explicit=false&page=2")).toBe("explicit=false");
  });

  it("reads a custom field's filter under its cf_ key, as the URL spells it", () => {
    expect(parseTableQuery({ cf_12: "3..9", cf_4: "true" })).toMatchObject({
      cf_12: "3..9",
      cf_4: "true",
    });
  });

  it("keeps custom field filters in a saved view in field order, and drops keys that only look like one", () => {
    expect(filterViewQuery("cf_12=1..&status=2&cf_9=x&cf_=y&cf_a=z")).toBe(
      "status=2&cf_9=x&cf_12=1.."
    );
  });

  it("narrows a list href to a custom field's value", () => {
    expect(withFilters("/project/3/track/all", { cf_7: "abc123" })).toBe(
      "/project/3/track/all?cf_7=abc123"
    );
  });
});

describe("parsePageParam", () => {
  it("reads a whole page number", () => {
    expect(parsePageParam({ page: "3" })).toBe(3);
    expect(parsePageParam({ page: ["2", "5"] })).toBe(2);
  });

  it("reads anything else as the first page", () => {
    expect(parsePageParam({})).toBe(1);
    expect(parsePageParam({ page: "0" })).toBe(1);
    expect(parsePageParam({ page: "-2" })).toBe(1);
    expect(parsePageParam({ page: "1.5" })).toBe(1);
    expect(parsePageParam({ page: "two" })).toBe(1);
  });
});

describe("withFilters", () => {
  it("narrows a list href to the given filters, and reads back through the parser", () => {
    const href = withFilters("/project/3/track/all", {
      artist: "Ada Vale & The Hollows",
      label: 7,
    });
    expect(href.startsWith("/project/3/track/all?")).toBe(true);

    const query = new URLSearchParams(href.split("?")[1]);
    expect(parseTableQuery(Object.fromEntries(query))).toMatchObject({
      artist: "Ada Vale & The Hollows",
      label: 7,
    });
  });

  it("leaves the href bare when no filter is set", () => {
    expect(withFilters("/project/3/track/all", {})).toBe(
      "/project/3/track/all"
    );
  });
});

describe("parseTableQuery view", () => {
  it("reads board", () => {
    expect(parseTableQuery({ view: "board" }).view).toBe("board");
  });

  it("reads anything else, including absent, as list", () => {
    expect(parseTableQuery({}).view).toBeUndefined();
    expect(parseTableQuery({ view: "list" }).view).toBeUndefined();
    expect(parseTableQuery({ view: "calendar" }).view).toBeUndefined();
  });
});

describe("the priority filter", () => {
  it("reads a level id from the URL, as the list of ids the server reads", () => {
    expect(parseTableQuery({ priority: "14" }).priority).toBe("14");
    expect(parseTableQuery({ priority: "3,7" }).priority).toBe("3,7");
  });

  it("drops a value that is not an id, rather than asking the server for it", () => {
    expect(parseTableQuery({ priority: "High" }).priority).toBeUndefined();
  });

  it("survives saving a view and applying it again", () => {
    const saved = filterViewQuery("priority=14&page=3&status=2");
    expect(saved).toBe("status=2&priority=14");
    expect(
      parseTableQuery(Object.fromEntries(new URLSearchParams(saved)))
    ).toMatchObject({ priority: "14", status: 2 });
  });

  it("survives saving a view holding several levels", () => {
    const saved = filterViewQuery("priority=3,7&page=2");
    expect(
      parseTableQuery(Object.fromEntries(new URLSearchParams(saved)))
    ).toMatchObject({ priority: "3,7" });
  });

  it("narrows a list href to one level", () => {
    const href = withFilters("/project/3/track/all", { priority: "14" });
    expect(href).toBe("/project/3/track/all?priority=14");
  });
});

describe("an id filter", () => {
  it("drops a value that is not a whole number", () => {
    expect(parseTableQuery({ status: "todo" }).status).toBeUndefined();
    expect(parseTableQuery({ label: "1.5" }).label).toBeUndefined();
    expect(parseTableQuery({ collection: "" }).collection).toBeUndefined();
  });
});

describe("view is not part of a saved view", () => {
  it("drops the param when a view is saved", () => {
    // Display mode is not a lens on the data — a saved list-view filter
    // should not force board mode open (or vice versa) when applied.
    expect(filterViewQuery("q=demo&status=3&view=board")).toBe(
      "q=demo&status=3"
    );
  });
});
