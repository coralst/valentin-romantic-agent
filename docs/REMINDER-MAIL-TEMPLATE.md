# The reminder mail: templates and the rules behind them

What Valentin sends when a date comes due, why it is shaped this way, and what it is
allowed to say. The code is `src/server/reminders/email-body.ts` (renders) and
`suggestions.ts` (decides what there is to render); this file is the specification
those two answer to.

## The one rule everything else follows from

**Nobody reads this before it goes out.**

Every other outbound message in this build is written by the model and approved by a
human who can see it — `propose_email` hands the model a `body` and the user presses
Confirm. A reminder fires from a timer, days ahead, with no turn in which anyone could
catch an invented restaurant or a table that was never held.

So: **the body is assembled by code, from stored rows.** No sentence in it is
model-authored. Every fact traces to something the user told Valentin or a field on a
curated venue. That is not a stylistic preference, it is the only reason this message
is safe to send unattended.

## Three templates, chosen by activity

`activityFor()` picks one from the user's own words. One template cannot serve all
three: a list of restaurants under "Call the florist" is noise, and the same list under
"let's keep it at home this year" argues with what he just said.

| Activity | Chosen when | Middle block |
|---|---|---|
| `restaurant` | default | three bookable curated venues |
| `at_home` | the occasion says `at home`, `stay in`, `night in`, `cook`, `movie night`, … | ideas drawn from her profile |
| `errand` | the row has a `title` — i.e. he wrote it himself via `set_reminder` | nothing; say the thing and stop |

`restaurant` is the default because it is the only one the product can *act* on —
Ontopo is the one integration that books. It is also the recoverable direction: a
restaurant he did not want is an idea he ignores, where silence about an evening in is
a reminder that did nothing.

Adding a fourth (a concert, a weekend away) is one case in `activityFor` plus one
paragraph in `email-body.ts`. Not a rewrite.

### Common skeleton

```
Subject: <Headline> is <gap>[ — <n> ideas]

Hi,

<Headline> is on <Weekday D Month>, <gap>.
[<timing note>]

<middle block — one of the three below>

<call to action>
<resume link>

— Valentin
```

- **Headline.** A `title` is used **verbatim** — his sentence, no name, no inflection.
  Otherwise it is possessive: `Maya's birthday`. An occasion he described himself
  already carries a determiner (`our third anniversary`), so it is used as written —
  the possessive would produce "Maya's our third anniversary".
- **Gap.** `today` / `tomorrow` / `a week away` / `two weeks away` / `a month away` /
  `N days away`. Recomputed from the clock at send time, never from the row's
  `leadDays`: if a deploy delayed the sweep a day, the row's notice would put the
  wrong number in the subject line, which is the one thing a reminder must get right.
- **Count in the subject.** What decides whether this is opened from a lock screen.
  Omitted when there is nothing to offer — no `— zero ideas`.
- **Timing note.** Directly under the date, because it changes the shape of the plan
  rather than the choice of venue. Read from `weekly_rhythm`; **omitted entirely** when
  her week is unknown. A guessed schedule is the worst thing this mail could contain.
- **Resume link** last, always, in all three templates. It is the only action either
  kind of reminder can offer, and it is why the mail is worth opening.
- **Plain text.** `buildRawMessage()` hardcodes `text/plain; charset="UTF-8"`. It
  renders identically everywhere, cannot carry a tracking pixel, and survives being
  forwarded.

### 1. `restaurant` — dinner out

```
Here is what fits what you have told me — she loves Mediterranean, romantic & quiet, near Tel Aviv:

  1. Hotel Montefiore, Montefiore, Tel Aviv — 4.6★ (2,180), ₪₪₪
     Bookable through me. Free at 19:30 and 21:00.
     You have been here before and rated it 5/5.

  2. Yaffo Tel Aviv, Tel Aviv
     Bookable through me — reply and I will check the times.

  3. Toto, Tel Aviv — 4.5★, ₪₪₪
     I cannot book this one — you would reserve it yourself:
     https://maps.google.com/?cid=123

Nothing is reserved — say the word and I will hold one of the first two.

Pick one, or tell me what you would rather:
```

Rules specific to this block:

- **Three, capped.** One suggestion is a decision made on his behalf; ten is a list he
  has to triage. Three is what a person reads standing at a bus stop.
- **Reach on every row, not once at the bottom.** The row is where the decision
  happens; a disclaimer at the end is read after the choice, if at all. `bookable` =
  Valentin can hold it. `discovery` = he books it himself, and then the URL is
  mandatory.
- **A place she rated leads.** The survey's entire payoff is that the next suggestion
  beats the last, and that is only visible if it is first.
- **Criteria only when the search actually matched.** Where no curated venue matched
  the cuisine or city, the list is a fallback ordering, and the line becomes the
  weaker, true `Here is what I found:`. Printing "fits what you have told me — she
  loves sushi" over a list that matched no sushi is the exact failure this rule exists
  to prevent.
- **Never a distance.** No radius is applied (that needs a geocode call), so the city
  is a search *term* and the wording is `near Tel Aviv`, never `within 10 km`.
- **No time is claimed free unless availability was actually checked.** With no check,
  `Bookable through me — reply and I will check the times.` The mail offers the room
  and finds the hour when he answers.
- **A price level is not a charge.** Rendered `₪₪₪`; no currency amount ever appears.
- **Nothing was booked.** May say a table *is available* and may offer to hold one.
  Must never say one was reserved. `email-body.test.ts` asserts this directly.

### 2. `at_home` — an evening in

```
You said you would rather keep it at home. Going on what you have told me:

  1. She loves Thai — cook it or order it in.
  2. Put Nina Simone on. I can build the playlist if Spotify is connected.

Reply and I will help you put it together:
```

- Each idea is a **restatement of a stored answer**, never a generated one. "Light some
  candles and put on soft music" is the model's voice in the one message no human reads
  first, and it is also worthless — he could have thought of it.
- **No "Nothing is reserved" line and no offer to hold anything**, because there is
  nothing to hold. Any mention of bookability here reads as not having listened.
- Knowing nothing about her produces an **ask**, not an invented evening:
  `Tell me what she likes and I will help you plan it.`

### 3. `errand` — a reminder he set himself

```
Call the florist is on Thursday 10 September, 5 days away.

That's all — you asked me to remind you.

Pick up where we left off:
```

He asked to be reminded, not for ideas. The empty-search apology is right about a
birthday and nonsense about an errand.

### The empty case (`restaurant`, nothing found)

```
I have not found anything worth suggesting yet. Open the conversation and tell me
what you have in mind and I will look properly.
```

**It still sends.** Suppressing the whole reminder because a search came back empty
turns a bad search into a missed birthday. This is also what a failed profile read
degrades to — the reminder is what he is owed; the suggestions are a bonus.

## Instructions, as a checklist

Anything added to this mail must satisfy all of these:

1. **Traceable.** Name the stored field or the venue field it came from. If you cannot,
   it does not go in.
2. **Never claim an action that did not happen** — no booking, no charge, no held table,
   no checked availability that was not checked.
3. **Omit rather than placeholder.** No rating is no `★`, not `null` and not "N/A".
4. **State the criteria only when they were applied.** A constraint listed but not used
   is a lie about how the list was built.
5. **Pure.** No clock, no network, no model inside `buildReminderEmail` — the same
   input twice must give the same bytes, and there is a test for it.
6. **Compose before the claim.** `markSent` stamps the row *before* the body is built,
   so anything slow between the two loses the reminder. All profile reads happen in
   `reminderContextFor`, ahead of the claim; nothing in the composer may make a network
   call.
7. **Read well as text.** No HTML path exists.

## Verifying it

```bash
npm run verify:reminder-mail -- --dry-run          # compose and print, send nothing
npm run verify:reminder-mail -- --to=you@example.com          # 5 days out: sends now
npm run verify:reminder-mail -- --to=you@example.com --days=8 # arms 08:30 tomorrow
```

Arms a reminder through the real `syncReminders`, sweeps once through the real
`gmailSender`, then asks Gmail whether the message is in the mailbox — because
"`reminder.sent` was logged" is not the same claim as "the mail arrived".

Reading the mailbox needs `gmail.readonly`, and **Google mints scopes at consent
time**: an existing refresh token does not gain it. Reconnect Google once in the
integrations panel (Disconnect, then Connect) before the inbox check can pass. Until
then the script exits `2` and says so, rather than reporting an unreadable mailbox as a
mail that never arrived.
