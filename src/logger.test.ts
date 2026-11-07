import { test } from "node:test";
import {
  ok as assert,
  deepStrictEqual as assertEquals,
} from "node:assert/strict";

test("Logflare receives structured messages and metadata through LogLayer", async () => {
  const names = ["LOGLAYER_SOURCE_ID", "LOGLAYER_API_KEY", "HOST_ID"] as const;
  const [sourceIdKey, apiKey, hostIdKey] = names;
  const previous = names.map((name) => process.env[name]);
  const originalFetch = globalThis.fetch;
  const requests: {
    batch: { message: string; metadata: Record<string, unknown> }[];
  }[] = [];

  try {
    process.env[sourceIdKey] = "test-source";
    process.env[apiKey] = "test-key";
    process.env[hostIdKey] = "test-host";
    globalThis.fetch = (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Promise.resolve(new Response("{}", { status: 200 }));
    };

    const { logInfo, logWarn, logError } = await import("./logger.ts");
    logInfo("structured message", { value: 42 });
    logWarn("plain warning");
    logError(new Error("test failure"));
    await new Promise((resolve) => setTimeout(resolve, 5200));

    assertEquals(requests.length, 1);
    const request = requests[0];
    assert(request);
    const entries = request.batch;
    const [info, warning, error] = entries;
    assert(info);
    assert(warning);
    assert(error);
    assertEquals(
      entries.map((entry) => entry.message),
      ["structured message", "plain warning", "test failure"],
    );
    assertEquals(info.metadata, {
      level: "info",
      value: 42,
      host: "test-host",
    });
    assertEquals(warning.metadata, { level: "warn", host: "test-host" });
    const { level, err } = error.metadata;
    assertEquals(level, "error");
    assertEquals((err as { message: string }).message, "test failure");
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, index) => {
      const value = previous[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
});
