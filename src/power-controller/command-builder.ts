import { TARGET_AMPS_MIN_START, TARGET_AMPS_MIN_STOP } from "../constants.ts";
import { WallboxLocation, WallboxStatus } from "../globals.ts";
import { powerToAmps } from "../utils.ts";
import { CalculatedTargetResults as SystemTargetValues } from "./dynamic-power-calculator.ts";
import { CommandType, PowerCommand } from "./power-controller.ts";

export interface SystemState {
  batteryMaxChargePower: number | undefined;
  wallboxPower: Map<WallboxLocation, number>;
  wallboxVictronStatus: Map<WallboxLocation, WallboxStatus>;
}

const MAX_HISTORY_TARGET_AMPS = 3;

export class CommandBuilder {
  private insideWallboxLastTargetAmps: (number | undefined)[];
  private outsideWallboxLastTargetAmps: (number | undefined)[];

  constructor() {
    this.insideWallboxLastTargetAmps = [];
    this.outsideWallboxLastTargetAmps = [];
  }

  // beware of side effects: this method depends on internal state to smooth commands
  createCommandsFromPowerSettings(
    state: SystemState,
    targets: SystemTargetValues
  ): PowerCommand[] {
    function addToList(
      list: (number | undefined)[],
      value: number | undefined
    ) {
      list.push(value);
      if (list.length > MAX_HISTORY_TARGET_AMPS) {
        list.shift();
      }
    }

    function getMinFromList(list: (number | undefined)[]): number | undefined {
      return list.reduce((previous, current) => {
        if (previous === undefined) return current;
        if (current === undefined) return previous;
        return Math.min(previous, current);
      }, undefined);
    }

    addToList(this.insideWallboxLastTargetAmps, targets.insideWallboxAmps);
    addToList(this.outsideWallboxLastTargetAmps, targets.outsideWallboxAmps);

    const insideWallboxPower = state.wallboxPower.get(WallboxLocation.Inside);

    const targetInsideWallboxAmps = getMinFromList(
      this.insideWallboxLastTargetAmps
    );

    const commands: PowerCommand[] = [];

    commands.push(
      ...this.createWallboxCommands(
        WallboxLocation.Inside,
        targetInsideWallboxAmps,
        insideWallboxPower == undefined
          ? undefined
          : powerToAmps(insideWallboxPower),
        state.wallboxVictronStatus.get(WallboxLocation.Inside)
      )
    );

    const outsideWallboxPower = state.wallboxPower.get(WallboxLocation.Outside);

    const targetOutsideWallboxAmps = getMinFromList(
      this.outsideWallboxLastTargetAmps
    );

    commands.push(
      ...this.createWallboxCommands(
        WallboxLocation.Outside,
        targetOutsideWallboxAmps,
        outsideWallboxPower == undefined
          ? undefined
          : powerToAmps(outsideWallboxPower),
        state.wallboxVictronStatus.get(WallboxLocation.Outside)
      )
    );

    if (
      targets.batteryChargePower != undefined &&
      targets.batteryChargePower != state.batteryMaxChargePower
    ) {
      commands.push(this.createBatteryCommand(targets.batteryChargePower));
    }

    return commands;
  }

  private createWallboxCommands(
    location: WallboxLocation,
    targetAmps: number | undefined,
    currentAmps: number | undefined,
    chargerStatus: WallboxStatus | undefined
  ): PowerCommand[] {
    if (targetAmps == undefined || targetAmps == currentAmps) return [];

    let newStartStop;
    let newCurrent;

    if (targetAmps < TARGET_AMPS_MIN_STOP) {
      // turn off
      if ((currentAmps ?? 0) > 0) {
        // stop
        newStartStop = 0;
        // set min current
        newCurrent = TARGET_AMPS_MIN_START;
      }
    } else {
      // status: Connected, Waiting for start
      if (
        (chargerStatus == WallboxStatus.Connected ||
          chargerStatus == WallboxStatus.WaitingForStart) &&
        targetAmps >= TARGET_AMPS_MIN_START
      ) {
        // start
        newStartStop = 1;
      }

      // adjust current
      newCurrent = targetAmps;
    }

    return [
      this.createWallboxCurrentCommand(location, newCurrent),
      this.createWallboxStartStopCommand(location, newStartStop),
    ].filter((cmd) => cmd !== undefined);
  }

  private createWallboxCurrentCommand(
    location: WallboxLocation,
    current: number | undefined
  ): PowerCommand | undefined {
    if (current == undefined) {
      return;
    } else {
      return {
        type:
          location == WallboxLocation.Inside
            ? CommandType.InsideCurrent
            : CommandType.OutsideCurrent,
        value: current,
      };
    }
  }

  private createWallboxStartStopCommand(
    location: WallboxLocation,
    startStop: number | undefined
  ): PowerCommand | undefined {
    if (startStop == undefined) {
      return;
    } else {
      return {
        type:
          location == WallboxLocation.Inside
            ? CommandType.InsideStartStop
            : CommandType.OutsideStartStop,
        value: startStop,
      };
    }
  }

  private createBatteryCommand(power: number): PowerCommand {
    return {
      type: CommandType.BatteryMaxChargePower,
      value: power,
    };
  }
}
