# DATE-07 — PASS

**Why this case exists.** A day-first written date ("14/2") must not be read month-first. Booking 2 Feb for a Valentine's dinner is the classic locale bug.

## Tool calls (2)

### 1. `check_shabbat`

- service: `hebcal`
- ok: `true` · 2ms
- **args:** `{"date":"2027-02-14"}`
- summary: Tel Aviv: Shabbat begins 2026-09-12 at 19:28 and ends (Havdalah, מוצ״ש) 2026-09-13 at 19:26 (Parashat Nitzavim-Vayeilech)

### 2. `find_restaurants`

- service: `ontopo`
- ok: `true` · 1ms
- **args:** `{"query":"Italian","limit":5}`
- summary: 2 option(s) for "Italian": Matteo (Tel Aviv; Italian, Meat, Fish, Seafood) — Italian, warm, dependable — an easy yes when nobody wants to be adventurous. | Rendez-vous (Tel Aviv; Italian, Kosher) — The kosher option that is genuinely a nice dinner rather than a compromise..

## Final reply

> Perfect — February 14th falls on a Sunday, so you're clear of Shabbat. I've found a couple of Italian places for you:
> 
> **Matteo** — warm, dependable Italian. Meat, fish, seafood. An easy yes when you want something good without overthinking it.
> 
> **Rendez-vous** — kosher Italian that's genuinely lovely rather than a compromise.
> 
> Which one appeals to you, or would you like me to look at something else?
