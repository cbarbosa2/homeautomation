import { assertEquals, assertRejects } from "@std/assert";
import {
  loadPersistentStorage,
  savePersistentStorage,
} from "./persistent-storage.ts";

Deno.test("authenticated mode save survives reloading storage", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = Deno.env.get("JSONBIN_ACCESS_KEY");
  Deno.env.set("JSONBIN_ACCESS_KEY", "test-access-key");
  let stored = { inside: 6, outside: 4 };
  globalThis.fetch = (_input, init) => {
    if (new Headers(init?.headers).get("X-Access-Key") !== "test-access-key") {
      return Promise.resolve(new Response(null, { status: 403 }));
    }
    if (init?.method === "PUT") stored = JSON.parse(String(init.body));
    return Promise.resolve(Response.json(stored));
  };
  try {
    await savePersistentStorage({ inside: 2, outside: 2 });
    assertEquals(await loadPersistentStorage(), { inside: 2, outside: 2 });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) Deno.env.delete("JSONBIN_ACCESS_KEY");
    else Deno.env.set("JSONBIN_ACCESS_KEY", originalKey);
  }
});

Deno.test("rejected storage writes propagate to the caller", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(null, { status: 403 }));
  try {
    await assertRejects(
      () => savePersistentStorage({ inside: 2, outside: 2 }),
      Error,
      "403",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("saves stay ordered and continue after a failed write", async () => {
  const originalFetch = globalThis.fetch;
  const started: number[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => release = resolve);
  globalThis.fetch = async (_input, init) => {
    const value = JSON.parse(String(init?.body));
    started.push(value.inside);
    if (started.length === 1) {
      await blocked;
      return new Response(null, { status: 403 });
    }
    return Response.json(value);
  };
  try {
    const first = assertRejects(
      () => savePersistentStorage({ inside: 2, outside: 4 }),
      Error,
      "403",
    );
    const second = savePersistentStorage({ inside: 5, outside: 2 });
    await Promise.resolve();
    assertEquals(started, [2]);
    release();
    await first;
    await second;
    assertEquals(started, [2, 5]);
  } finally {
    release();
    globalThis.fetch = originalFetch;
  }
});

Deno.test("writes use the master key to disable versioning even when an access key exists", async () => {
  const originalFetch = globalThis.fetch;
  const keys = ["JSONBIN_ACCESS_KEY", "JSONBIN_MASTER_KEY"];
  const previous = keys.map((key) => Deno.env.get(key));
  Deno.env.set(keys[0]!, "test-access");
  Deno.env.set(keys[1]!, "test-master");
  globalThis.fetch = (_input, init) => {
    const headers = new Headers(init?.headers);
    assertEquals(headers.get("X-Master-Key"), "test-master");
    assertEquals(headers.get("X-Access-Key"), null);
    assertEquals(headers.get("X-Bin-Versioning"), "false");
    return Promise.resolve(Response.json({}));
  };
  try {
    await savePersistentStorage({ inside: 2, outside: 2 });
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => {
      if (previous[i] === undefined) Deno.env.delete(key);
      else Deno.env.set(key, previous[i]!);
    });
  }
});
