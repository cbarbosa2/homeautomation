# Home charging automation

Coordinates home battery charging and two vehicle wallboxes using solar energy,
charging preferences, and available grid capacity.

## Language

**Device telemetry**:
Readings received from the home battery, energy system and wallboxes, interpreted
separately as fresh control evidence, display history and monitoring values.

**SOC**:
The home battery's state of charge, expressed as a percentage. SOC margins are
percentage points.

**Minimum SOC**:
The home battery's minimum state-of-charge target, adjusted for overnight charging
and reset for daytime operation.

**Solar surplus**:
Solar power available after household consumption that can be diverted from
battery charging to a wallbox.

**Maximum possible power**:
The highest wallbox charging power permitted by charger limits, grid capacity,
and wallbox priority.

**Wallbox priority**:
The first claim on available charging power held by the wallbox whose mode was
most recently selected, including selecting the same mode again. The preference
persists while that wallbox cannot charge.

**Manual mode**:
A wallbox mode in which the user controls charging and accepts responsibility for
its grid impact; automatic current and start/stop intervention is excluded.

### Agreed mode vocabulary

**Max mode**:
Unrestricted-source automatic EV charging at maximum possible power.
_Avoid_: On

**Night mode**:
Scheduled Max charging during the night and Sun charging during the day.

**Battery mode**:
Battery-supported automatic EV charging with limited grid import.

**Reserve mode**:
Nighttime battery-supported EV charging that preserves energy for the next day,
combined with Sun charging during the day.
_Avoid_: ESS, ESS Only

**Sun mode**:
Automatic EV charging using solar surplus.
_Avoid_: Sun Only

### Control conditions

**Night**:
The period from 22:00 inclusive to 08:00 exclusive in Europe/Lisbon.

**Conservative shared budget**:
A combined 12 A cap on automatic wallbox and battery charging when readings
required for control are missing or stale. Charging modes still determine
eligibility, and Manual wallboxes are exempt.
