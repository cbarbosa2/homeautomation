import { assertEquals } from "@std/assert";

Deno.test("Logflare receives structured messages and metadata through LogLayer", async () => {
  const names = ["LOGLAYER_SOURCE_ID", "LOGLAYER_API_KEY", "HOST_ID"];
  const previous = names.map((name) => Deno.env.get(name));
  const originalFetch = globalThis.fetch;
  const requests: {
    batch: { message: string; metadata: Record<string, unknown> }[];
  }[] = [];

  try {
    Deno.env.set("LOGLAYER_SOURCE_ID", "test-source");
    Deno.env.set("LOGLAYER_API_KEY", "test-key");
    Deno.env.set("HOST_ID", "test-host");
    globalThis.fetch = (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Promise.resolve(new Response("{}", { status: 200 }));
    };

    const { logInfo, logWarn, logError } = await import(
      "./logger.ts?logflare-test"
    );
    logInfo("structured message", { value: 42 });
    logWarn("plain warning");
    logError(new Error("test failure"));
    await new Promise((resolve) => setTimeout(resolve, 5200));

    assertEquals(requests.length, 1);
    const entries = requests[0]!.batch;
    assertEquals(entries.map((entry) => entry.message), [
      "structured message",
      "plain warning",
      "test failure",
    ]);
    assertEquals(entries[0]!.metadata, {
      level: "info",
      value: 42,
      host: "test-host",
    });
    assertEquals(entries[1]!.metadata, { level: "warn", host: "test-host" });
    assertEquals(entries[2]!.metadata["level"], "error");
    assertEquals(
      (entries[2]!.metadata["err"] as { message: string }).message,
      "test failure",
    );
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, index) => {
      const value = previous[index];
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    });
  }
});
