import { BATTERY_CELL_PATHS } from "../battery-cell-telemetry.ts";
import { VICTRON_PORTAL_ID } from "../constants.ts";
import type { MqttClient } from "../mqtt-client.ts";
import { REFRESH_PATHS } from "../control-telemetry.ts";

export class MqttAwakeTask {
  constructor(private mqttClient: Pick<MqttClient, "publish">) {}

  public async execute(): Promise<void> {
    await this.mqttClient.publish(`R/${VICTRON_PORTAL_ID}/keepalive`, "");
    for (const path of [
      ...REFRESH_PATHS,
      ...Object.values(BATTERY_CELL_PATHS),
    ]) {
      await this.mqttClient.publish(`R/${VICTRON_PORTAL_ID}/${path}`, "");
    }
  }
}
