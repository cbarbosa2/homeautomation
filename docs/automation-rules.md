# Automation rules

Manage overnight battery charging when daytime solar energy is insufficient, and control the inside and outside wallboxes. These rules describe the intended behavior.

## Charging modes

SOC means the home battery's state of charge. SOC margins are percentage points. All times use **Europe/Lisbon**, including daylight-saving changes. Night runs from 22:00 inclusive to 08:00 exclusive; remaining hours until 08:00 are rounded up to whole hours.

“Solar surplus” is excess solar power available after household consumption, diverted to a wallbox instead of battery charging. “Maximum possible” means the highest power allowed by charger limits, grid capacity, and wallbox priority.

| Mode | Behavior |
| --- | --- |
| Off | Stop charging. |
| Sun Only | Use solar surplus only while battery SOC is above minimum SOC + 1 percentage point. At **95% SOC or higher**, charge at maximum possible power even without solar surplus. |
| ESS Only | Same as Sun Only; also charge at maximum possible power at night while SOC is above minimum SOC + 2 percentage points per remaining hour until 08:00. |
| Night | Same as Sun Only; also charge at maximum possible power throughout the night. |
| On | Charge at maximum possible power at any time. |
| Manual | Send no automatic current or start/stop commands to this wallbox, including for grid protection. The user is responsible for its current and grid impact. |

For example, at 23:00 the ESS Only night condition requires SOC above minimum SOC + 18 percentage points.

## Wallbox priority

Both wallboxes may charge simultaneously. The first to begin charging gets priority for available power; the other uses the remainder, subject to its mode.

Release priority when that vehicle is fully charged, disconnected, encounters an error preventing charging, or switches to Off or Manual. Also transfer priority when the priority charger's mode conditions no longer permit charging but the other charger's conditions do.

A pause caused only by insufficient available power retains priority while the charger's mode conditions still apply.

## Overnight battery target

At **22:01**, set the battery's minimum SOC using tomorrow's Forecast.Solar estimate and current SOC. At **08:00**, reset minimum SOC to **5%**.

The evening calculation uses a **40 kWh** battery, **95%** charging efficiency, and **2–15 kWh** expected daytime consumption. The seasonal floor is **30% from October 15 through February**, otherwise **10%**; the ceiling is **85%**.

With `E` = tomorrow's forecast in kWh × 0.95, `F` = seasonal floor, `S` = current SOC, and `H` = rounded-up hours until 08:00:

```text
lower = F − 100 × (E − 15) / 40
upper = 85 − 100 × (E − 2) / 40
target = max(F, min(max(S − 2 × H, lower), upper, 85))
```

This reserves energy for the next day while allowing overnight consumption and leaving room for solar charging. See [the target calculation](../src/tasks/set-soc-limit-task.ts).

## Current limits

- Start charging only with at least **10 A** available.
- Once charging, continue at **7 A** or above; stop below that threshold.
- Maximum current: **20 A inside**, **32 A outside**.

## Grid protection

Keep grid current below **28 A**, leaving a **2 A margin** beneath the installation's 30 A limit. Continuously monitor grid power and adjust automatic wallbox charging and the battery's maximum charging power. Grid protection takes precedence over automatic requests for maximum charging power; Manual wallboxes are exempt from intervention.

When readings required for control are missing or stale, use a conservative **12 A shared budget** for automatic wallbox and battery charging. This is a cap, not permission to bypass mode conditions; Manual wallboxes remain exempt. Resume normal allocation when valid readings return.
