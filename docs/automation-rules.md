# Automation rules

Manage overnight battery charging when daytime solar energy is insufficient, and control the inside and outside wallboxes. These rules describe the intended behavior.

## Charging modes

SOC means the home battery's state of charge. SOC margins are percentage points. All times use **Europe/Lisbon**, including daylight-saving changes. Night runs from 22:00 inclusive to 08:00 exclusive; remaining hours until 08:00 are rounded up to whole hours.

Remaining hours use actual elapsed time until the next Lisbon 08:00, including any daylight-saving clock change.

“Solar surplus” is excess solar power available after household consumption, diverted to a wallbox instead of battery charging. “Maximum possible” means the highest power allowed by charger limits, grid capacity, and wallbox priority.

| ID | Mode | Behavior |
| --- | --- | --- |
| 1 | Manual | Send no automatic wallbox current or start/stop commands, including grid protection. The user is responsible for its current and grid impact. |
| 2 | Sun | Use solar surplus while battery SOC is above minimum SOC + 1 percentage point; target zero whole-house grid import. |
| 3 | Reserve | Sun by day. At night, use battery support while SOC is above minimum SOC + 2 percentage points per rounded-up remaining hour until 08:00; otherwise use Sun. Battery support also requires SOC strictly above minimum SOC + 4 percentage points. |
| 4 | Battery | Use battery support strictly above minimum SOC + 4 percentage points. At or below that threshold, genuine solar surplus remains usable without Sun's minimum-SOC eligibility guard. |
| 5 | Night | Maximum possible charging at night; Sun by day. |
| 6 | Max | Maximum possible charging at any time using grid, battery and solar. |

Battery-supported operation targets whole-house grid import below **100 W**.
Brief excursions are allowed during startup and demand changes. Solar operation
targets zero import. Battery and nighttime Reserve pause while the battery is
charging below minimum SOC; grid-funded battery charging is not EV headroom.

Strictly **above 95% SOC**, Sun, Reserve and daytime Night use battery-supported
operation, overriding Reserve's overnight reserve margin. At exactly 95% or below,
the ordinary rules apply. This exception still requires fresh telemetry and
SOC strictly above minimum SOC + 4 percentage points; it does not authorize unrestricted grid charging.

The inside wallbox charges the BMW i3. In Sun, Reserve, Battery and Night, a BMW
SOC reading of at least 80% and no more than 90 minutes old stops it, including
during the above-95% exception. Missing or older BMW readings do not interrupt
charging. Max and Manual are exempt. BMW telemetry may lag, so 80% is approximate.

For example, at 23:00 Reserve's ordinary battery-support condition requires SOC
above minimum SOC + 18 percentage points.

### Battery support regulation

Assume discharge is available strictly when SOC is above minimum SOC + **4
percentage points**. This applies to Battery, nighttime Reserve and the
above-95% exception. Reserve also retains its remaining-night margin. Exactly
minimum SOC + 4 does not permit battery support. There is no extra hysteresis.

One eligible wallbox at a time starts at **10 A**, in priority order, subject to
installation headroom and outstanding device commands. Continuing loads increase
in whole-amp steps only after fresh settings and measured power confirm the
preceding command, retaining increase smoothing. No observed battery discharge
is required to start or continue.

Startup and increases allow a bounded 30-second inverter response window,
starting when command building first produces the nonzero allocation rather
than while smoothing or reservations delay it. Repeated commands do not extend
that window. Fresh grid import above the target beyond that response causes
reductions; charging stops below the 7 A continuation threshold. Sun retains its
zero-import target when sharing power with a battery-supported EV.

After power regulation or insufficient available power stops an active or pending
battery-supported allocation, that wallbox waits **15 minutes** before another
battery-supported start. The delay starts with the first zero allocation built
for that stop; repeated stop commands do not extend it. Each failed retry starts
a new delay. The other wallbox may still charge according to priority. Genuine
solar surplus remains usable during the delay.

This applies to Battery, nighttime Reserve and the above-95% exception. SOC
ineligibility, vehicle cutoff, disconnection and stale telemetry do not create a
retry delay. Existing delays survive telemetry interruptions and priority changes,
but a selected mode change clears that wallbox's delay. Delays are held in memory
and discarded on service restart. At expiry, normal eligibility, fresh telemetry,
command confirmation and smoothing still apply. There are no discharge probes,
learned ceilings or failure baselines.

Household and Manual loads remain outside automatic intervention. If these loads
or an unrestricted EV require import above a constrained EV's whole-house target,
pause that constrained EV even when it has priority. Include pending unrestricted
starts when assessing this conflict, so changing measured import cannot alternate
priority between infeasible modes.

## Wallbox priority

Both wallboxes may charge simultaneously. The charger whose mode was most recently set gets priority for available power; the other uses the remainder, subject to its mode. Reapplying the same mode also claims priority. Dashboard Set buttons, physical switches, and API mode commands all follow this rule, including Manual selections.

The preference is retained when that vehicle is fully charged, disconnected, encounters an error preventing charging, switches to Manual, or its mode conditions do not permit charging. The other charger may use available power meanwhile. The preferred charger regains priority automatically when eligible again. A pause caused by insufficient available power also retains preference.

Persist the preference together with both modes and restore it on restart. Loading modes at startup does not count as setting them. Inside is preferred when no valid saved preference exists. Charging-start order does not affect priority.

Eligible automatic wallboxes receive power in priority order; battery charging receives the remainder. This order also applies within the conservative 12 A shared budget.

## Overnight battery target

At **22:01**, set the battery's minimum SOC using tomorrow's Forecast.Solar estimate and current SOC. At **08:00**, reset minimum SOC to **5%**.

Use a forecast for the required Lisbon calendar date fetched no more than **six hours** ago. A forecast of zero is valid; a missing or invalid forecast is not.

If current SOC or the required forecast is unavailable or stale at the evening adjustment, retain the existing minimum SOC and retry **every five minutes until midnight**, stopping after success. Keep forecast fetching hourly. Retries retain the original forecast target date and use current SOC and remaining hours at the time of the successful retry. If none succeeds, retain the existing minimum until the normal morning reset.

Do not catch up scheduled SOC adjustments missed while the service was stopped. Pending retries are held in memory and discarded on restart.

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

When readings required for control are missing or stale, use a conservative **12 A shared budget** for automatic wallbox and battery charging. Only Max and nighttime Night may use this fallback; battery-supported and solar requests pause without the required evidence. This is a cap, not permission to bypass mode conditions; Manual wallboxes remain exempt. Resume normal allocation when valid readings return.

Treat missing PV inverter power as zero, including during the day. The inverter
may stop reporting when sunlight is insufficient; all other required readings
still need to be fresh for normal allocation.

Actively refresh required device telemetry every **30 seconds**. Treat readings as stale after **60 seconds** without a valid refresh. This device-telemetry threshold does not apply to the external solar forecast.
