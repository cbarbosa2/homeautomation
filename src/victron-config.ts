/** Validate identifiers before creating MQTT clients or making API requests. */
export function readVictronConfig(env: (name: string) => string | undefined) {
  const portalId = env("VICTRON_PORTAL_ID")?.trim();
  if (!portalId || (/[\s/+#]/u.test(portalId) || portalId.includes("\0"))) {
    throw new Error(
      "VICTRON_PORTAL_ID must be a nonempty MQTT topic segment without wildcards",
    );
  }
  const installationId = env("VICTRON_INSTALLATION_ID")?.trim();
  if (
    !installationId || !/^[0-9]+$/.test(installationId) ||
    !/[1-9]/.test(installationId)
  ) {
    throw new Error(
      "VICTRON_INSTALLATION_ID must be a positive decimal integer",
    );
  }
  return { portalId, installationId };
}
