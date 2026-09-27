import { MqttClient } from "../mqtt-client.ts";
import { PORTAL, REFRESH_PATHS } from "../control-telemetry.ts";

export class MqttAwakeTask {
  constructor(private mqttClient: Pick<MqttClient, "publish">) {}
  public async execute(): Promise<void> {
    await this.mqttClient.publish(`R/${PORTAL}/keepalive`, "");
    for (const path of REFRESH_PATHS) {
      await this.mqttClient.publish(`R/${PORTAL}/${path}`, "");
    }
  }
}
