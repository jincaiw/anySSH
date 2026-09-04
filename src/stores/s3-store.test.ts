import { describe, it, expect, beforeEach, vi } from "vitest";
import type { S3Connection } from "../types";
import { useS3Store } from "./s3-store";

// The store reaches the backend via a dynamic `import("@tauri-apps/api/core")`,
// so we mock that module's `invoke`. Each test swaps the implementation.
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

function makeConn(id: string, label: string): S3Connection {
  return {
    id,
    label,
    provider: "aws",
    region: "us-east-1",
    endpoint: null,
    bucket: "my-bucket",
    path_style: false,
    group_id: null,
    color: null,
    environment: null,
    notes: null,
    created_at: "2024-01-01T00:00:00Z",
  };
}

const a = makeConn("a", "alpha");
const b = makeConn("b", "bravo");
const c = makeConn("c", "charlie");

describe("s3-store reorderConnections", () => {
  beforeEach(() => {
    invoke.mockReset();
    useS3Store.setState({ connections: [a, b, c] });
  });

  it("optimistically applies the new order and persists the id list", async () => {
    invoke.mockResolvedValue(undefined);
    const newOrder = [c, a, b];

    await useS3Store.getState().reorderConnections(newOrder);

    expect(useS3Store.getState().connections).toEqual(newOrder);
    expect(invoke).toHaveBeenCalledWith("reorder_s3_connections", {
      orderedIds: ["c", "a", "b"],
    });
  });

  it("applies the new order immediately, before the backend resolves", async () => {
    let resolveInvoke: () => void = () => {};
    invoke.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveInvoke = resolve;
      }),
    );

    const promise = useS3Store.getState().reorderConnections([b, c, a]);

    // Optimistic update is visible synchronously, while invoke is still pending.
    expect(useS3Store.getState().connections.map((conn) => conn.id)).toEqual(["b", "c", "a"]);

    resolveInvoke();
    await promise;
  });

  it("reverts to the previous order and rethrows when persistence fails", async () => {
    invoke.mockRejectedValue(new Error("db locked"));

    await expect(
      useS3Store.getState().reorderConnections([c, b, a]),
    ).rejects.toThrow("db locked");

    // Order rolled back to the pre-drag state.
    expect(useS3Store.getState().connections).toEqual([a, b, c]);
  });
});

describe("s3-store currentBucket navigation", () => {
  const s = () => useS3Store.getState().sessions.get("s1");

  beforeEach(() => {
    invoke.mockReset();
    useS3Store.setState({ sessions: new Map() });
    useS3Store.getState().openSession("s1", "alpha");
  });

  it("opens a session on the bucket list (currentBucket null) and clears prefix", () => {
    expect(s()?.currentBucket).toBeNull();
    expect(s()?.currentPrefix).toBe("");
    expect(s()?.entries).toEqual([]);
  });

  it("entering a bucket resets the prefix and entry cache", () => {
    // Simulate having navigated into a subfolder with cached entries.
    useS3Store.getState().setEntries("s1", "photos/2024/", [
      { name: "a.jpg", key: "photos/2024/a.jpg", entry_type: "File", size: 1, last_modified: null, storage_class: null },
    ]);

    useS3Store.getState().setCurrentBucket("s1", "bucket-a");

    expect(s()?.currentBucket).toBe("bucket-a");
    expect(s()?.currentPrefix).toBe("");
    expect(s()?.entries).toEqual([]);
  });

  it("returning to the bucket list sets currentBucket to null", () => {
    useS3Store.getState().setCurrentBucket("s1", "bucket-a");
    useS3Store.getState().setCurrentBucket("s1", null);

    expect(s()?.currentBucket).toBeNull();
    expect(s()?.currentPrefix).toBe("");
  });

  it("ignores navigation for an unknown session", () => {
    expect(() => useS3Store.getState().setCurrentBucket("nope", "x")).not.toThrow();
  });
});
