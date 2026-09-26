# Home charging automation

Coordinates home battery charging and two vehicle wallboxes using solar energy,
charging preferences, and available grid capacity.

## Language

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
The first claim on available charging power held by the vehicle that began
charging first, while its charging eligibility persists. A pause caused solely by
insufficient power does not release that claim.

**Manual mode**:
A wallbox mode in which the user controls charging and accepts responsibility for
its grid impact; automatic current and start/stop intervention is excluded.

**Night**:
The period from 22:00 inclusive to 08:00 exclusive in Europe/Lisbon.

**Conservative shared budget**:
A combined 12 A cap on automatic wallbox and battery charging when readings
required for control are missing or stale. Charging modes still determine
eligibility, and Manual wallboxes are exempt.
