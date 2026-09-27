import { assertEquals, assertThrows } from "@std/assert";
import { readVictronConfig } from "./victron-config.ts";

Deno.test("Victron configuration trims identifiers and preserves decimal IDs as strings", () => {
  const values: Record<string, string> = {
    VICTRON_PORTAL_ID: " test-portal ",
    VICTRON_INSTALLATION_ID: " 123456 ",
  };
  assertEquals(readVictronConfig((name) => values[name]), {
    portalId: "test-portal",
    installationId: "123456",
  });
});

Deno.test("Victron configuration rejects missing or invalid values without revealing them", () => {
  for (
    const [name, invalidValues, message] of [
      [
        "VICTRON_PORTAL_ID",
        [undefined, "", " ", "a/b", "a+", "a#", "a\u0000", "a b"],
        "VICTRON_PORTAL_ID must be a nonempty MQTT topic segment without wildcards",
      ],
      ["VICTRON_INSTALLATION_ID", [
        undefined,
        "",
        " ",
        "0",
        "000",
        "-1",
        "1.5",
        "1e3",
        "abc",
        "1/2",
      ], "VICTRON_INSTALLATION_ID must be a positive decimal integer"],
    ] as const
  ) {
    for (const invalid of invalidValues) {
      const values: Record<string, string | undefined> = {
        VICTRON_PORTAL_ID: "test-portal",
        VICTRON_INSTALLATION_ID: "123456",
        [name]: invalid,
      };
      const error = assertThrows(
        () => readVictronConfig((key) => values[key]),
        Error,
      );
      assertEquals(error.message, message);
    }
  }
});
