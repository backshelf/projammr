import { describe, expect, test } from "bun:test";
import { attachmentStateFor } from "@/components/uploads/attachment-state";

describe("attachmentStateFor", () => {
  test("maps an in-flight byte transfer to the uploading state", () => {
    expect(attachmentStateFor("uploading")).toBe("uploading");
  });

  test("maps a row following a background job to the processing state", () => {
    expect(attachmentStateFor("following")).toBe("processing");
  });

  test("maps a failed row to the error state", () => {
    expect(attachmentStateFor("failed")).toBe("error");
  });

  test("maps a finished row to done", () => {
    expect(attachmentStateFor("done")).toBe("done");
  });
});
