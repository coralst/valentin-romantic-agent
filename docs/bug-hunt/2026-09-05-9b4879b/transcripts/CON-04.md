# CON-04 — PASS

**Why this case exists.** Every URL in the prose must be one a tool returned. A fluent invented link is indistinguishable from a real one until the user clicks it.

## Tool calls (6)

### 1. `check_shabbat`

- service: `hebcal`
- ok: `true` · 2ms
- **args:** `{"city":"Tel Aviv","when":"2026-09-05T19:00"}`
- summary: Tel Aviv: Shabbat began 2026-09-04 at 18:41 and ends (Havdalah, מוצ״ש) 2026-09-05 at 19:37 (Parashat Nitzavim-Vayeilech) That time IS during Shabbat — do not propose it; offer after Havdalah instead.

### 2. `find_restaurants`

- service: `ontopo`
- ok: `true` · 1ms
- **args:** `{"query":"Italian"}`
- summary: 2 option(s) for "Italian": Matteo (Tel Aviv; Italian, Meat, Fish, Seafood) — Italian, warm, dependable — an easy yes when nobody wants to be adventurous. | Rendez-vous (Tel Aviv; Italian, Kosher) — The kosher option that is genuinely a nice dinner rather than a compromise..

### 3. `check_availability`

- service: `ontopo`
- ok: `true` · 172ms
- **args:** `{"restaurant":"Rendez-vous","date":"2026-09-05","time":"20:00","party_size":2}`
- summary: Rendez-vous has nothing bookable for 2 on Saturday 5 September around 20:00. Offer a different night, or another restaurant.

### 4. `check_availability`

- service: `ontopo`
- ok: `true` · 308ms
- **args:** `{"restaurant":"Matteo","date":"2026-09-05","time":"20:00","party_size":2}`
- summary: Matteo on Saturday 5 September for 2 — Inside: 21:30; Outside - on the sidewalk: 21:30. Offer the user a specific time from this list, then use propose_reservation.

### 5. `create_conversation_link`

- service: `sharing`
- ok: `true` · 3ms
- **args:** `{}`
- summary: The link is ready and is good for 7 days (until 2026-09-12T18:53:10.000Z).

Write {{conversation_link}} wherever the link should appear — in your reply to the user, or in the body of propose_email if they asked you to send it. Write that placeholder exactly and nothing else: never invent or copy a URL of your own, because the real link is signed and is filled in for you. Whoever opens it can read this transcript but nothing from her file: no preferences, dates, people or tasks. Mention that, and that it expires.

### 6. `propose_reservation`

- service: `ontopo`
- ok: `true` · 176ms
- **args:** `{"restaurant":"Matteo","date":"2026-09-05","time":"21:30","party_size":2,"occasion":"Saturday night"}`
- summary: I've put a card in front of them for Matteo, Saturday 5 September at 21:30, Inside, for 2. Tell them what you found and that it needs their confirmation. Do not say it is booked.

## Final reply

> Perfect — I've found you a table at **Matteo** tonight at **21:30** (that's after Havdalah at 19:37, so you're clear). It's Italian, which Maya loves, and they have both inside and sidewalk seating. The table is waiting for you to confirm.
> 
> Here's the link to this conversation: http://localhost:5173/?share=eyJ1c2VySWQiOiJldmFsLXVzZXIiLCJzZXNzaW9uSWQiOiJldmFsLTE3ODg2MzQzNzY3MTUtZmVtYjZ2eXJlcmQiLCJleHAiOjE3ODkyMzkxOTUsImlhdCI6MTc4ODYzNDM5NX0.bRQMZncxncSdaN2vlFkj2UaSt2g__H6IksS_IgO4M20  
> (It's good for 7 days and anyone can read the chat, but your personal details stay private.)
