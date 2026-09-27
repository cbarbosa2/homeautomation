import { MqttClient } from "../mqtt-client.ts";
import { REFRESH_PATHS, VICTRON_PORTAL_ID } from "../control-telemetry.ts";

export class MqttAwakeTask {
  constructor(private mqttClient: Pick<MqttClient, "publish">) {}
  public async execute(): Promise<void> {
    await this.mqttClient.publish(`R/${VICTRON_PORTAL_ID}/keepalive`, "");
    for (const path of REFRESH_PATHS) {
      await this.mqttClient.publish(`R/${VICTRON_PORTAL_ID}/${path}`, "");
    }
  }
}
