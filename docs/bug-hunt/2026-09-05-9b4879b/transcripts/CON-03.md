# CON-03 — PASS

**Why this case exists.** A stated dietary constraint must survive into the recommendation. Proposing a shellfish place after being told no shellfish is the memory failure with real consequences.

## Tool calls (2)

### 1. `check_shabbat`

- service: `hebcal`
- ok: `true` · 4ms
- **args:** `{"city":"Tel Aviv","when":"2026-09-06"}`
- summary: Tel Aviv: Shabbat begins 2026-09-12 at 19:28 and ends (Havdalah, מוצ״ש) 2026-09-13 at 19:26 (Parashat Nitzavim-Vayeilech)

### 2. `find_restaurants`

- service: `ontopo`
- ok: `true` · 1ms
- **args:** `{"query":"Italian","limit":5}`
- summary: 2 option(s) for "Italian": Matteo (Tel Aviv; Italian, Meat, Fish, Seafood) — Italian, warm, dependable — an easy yes when nobody wants to be adventurous. | Rendez-vous (Tel Aviv; Italian, Kosher) — The kosher option that is genuinely a nice dinner rather than a compromise..

## Final reply

> Yes, **Matteo** works perfectly for Maya. They serve Italian with meat and fish options, and while they do have shellfish on the menu, there's plenty she can eat — pasta, risotto, fish dishes, meat mains. She just skips the shellfish plates, which is straightforward at any Italian restaurant.
> 
> So you're good there. Want me to check what tables they have?
