# Getting into her profile, and getting the names right

**Status:** implemented on `worktree-fix-profile-nav-and-rail`, commit `017604b`. Every
claim below was checked against the code in that worktree; the verification section says
exactly what was run. Written so the next person can see *why* each control moved, not
just that it did.

## The four faults, as reported

All four came from the same demo walkthrough, and three of them are the same kind of
mistake — a control that says one thing and does another.

1. **Her portrait did nothing you would expect.** Clicking the cameo at the top of the
   claret brief opened a *file picker*. People click a face to go to the person.
2. **The icon rail had a ♥.** It opened her profile, i.e. the same place the portrait
   should lead — a second, abstract door to one room.
3. **The account chip said "Signed in as Samantha".** Samantha is the *partner* the demo
   persona is about. The person signed in is Ralf. The chip was reading the wrong field.
4. **"Load demo profile" was offered while the demo profile was loaded.** Pressing it
   reloads what you are already looking at.

## Why they happened

Two root causes, and neither is a typo.

**One string doing two jobs.** `DemoPersona.name` was the persona's label *and*,
transitively, the identity chip's text. Those are different people: the persona is "about
Samantha", the session is "Ralf's". `describePersonas()` → `/api/config` →
`auth-context.adopt(demoLabel)` → `userLabel` → `UserChip` is a five-hop pipe, and nothing
along it could notice that the name it was carrying had changed meaning.

**A navigation control chosen for its shape, not its meaning.** The ♥ predates the brief's
portrait. Once her face was on screen, the heart became the *less* obvious of two doors,
while the face was wired to a file dialog. The only thing a heart can plausibly denote in
this app is the person — which is precisely what the portrait already is.

## The plan, as executed

### 1. The cameo becomes the door — `brief/WhoHeader.tsx`, `BriefRail.tsx`

`onEditPhoto` → `onOpenProfile`, wired to `view.openDossier`. The accessible name is
`Open <name>'s full profile` (`Open her full profile` before her name is known).

The photo upload is **not lost, and was not moved**: it already lived on the dossier's own
`PartnerAvatar`, which owns the file-type and size validation. What went away is the
brief's duplicate hidden `<input>` and its `handlePhotoChange` — a second upload path with
none of the checks. Upload is now one click further in, which is the right depth for a
destructive-ish action on a demo surface.

### 2. The rail loses the ♥ — `IconRail.tsx`, `AppLayout.tsx`

The button and its three props (`isDossierActive`, `onToggleDossier`, `dossierToggleRef`)
are gone from both call sites. A comment stands where it was, naming the two remaining
doors (her portrait, and the brief footer's "Full profile →") so nobody restores it by
reflex.

**The one non-obvious consequence — focus.** Closing the dossier returns focus to whatever
opened it, via `dossierToggleRef`. The ♥ was always mounted, so this was a one-liner. Her
portrait lives in the *chat shell*, which is unmounted at the moment `closeDossier` runs —
the surface swap has only been queued. So `view-context`'s `applyClose` now tries the ref
synchronously and falls back to `requestAnimationFrame` when it is empty, the same shape
`returnToChat` already used to find the composer. Without this, closing the dossier
strands focus on a removed button.

The mobile "Dossier" tab is untouched: `toggleDossier` survives for it, and
`MobileNav`'s `isDossierActive` is a separate, legitimate use of that flag.

### 3. `userName` beside `name` — `demo-personas.ts`, `runtime-config.ts`, `auth-context.tsx`

`DemoPersona` gains `userName` ("Ralf" for the Samantha persona, "Guest" for the empty
one), `describePersonas()` publishes it, and `signInAsDemo` labels the session with it.
The chip may read *only* `userName`; the doc comments on both fields say so, because the
fields are one line apart and the failure mode is silent.

`DemoPersonaSummary.userName` is **optional on the client on purpose.** A frontend
deployed against an older server falls back to the neutral `"Demo profile"` rather than to
`name` — falling back to `name` would quietly reintroduce the exact bug being fixed, and
"Demo profile" is merely vague, which is a much cheaper wrong answer.

`userName` also matches the address the login form prefills (`LoginScreen`'s
`PREFILLED_EMAIL`, `Ralf1988@gmail.com`), so the chip agrees with the door you came in
through.

### 4. Hide a control that would repeat itself — `DemoToolbar.tsx`

"Load demo profile" is hidden when `auth.isDemo` **and** any preference category is
non-empty. Keyed on preferences-in-view rather than on the persona id for two reasons:
Reset then brings the button back (which is the whole point of Reset), and a local
no-Cognito run — where `isDemo` is false — is unaffected.

## Verification

Run from the worktree. All of this was run and passed at `017604b`:

```
npm run lint      # tsc --noEmit — clean
npx vitest run    # 97 files, 1556 tests, 0 failures
npm run build     # vite production build — clean
```

Six test files were updated rather than deleted, because each was pinning real behaviour
that changed:

- `IconRail.test.tsx` — plus a **guard test** asserting no `rail-profile-button`, no
  `Her profile` role, and no `♥` anywhere in the rail's text.
- `DossierRouting.test.tsx` — 8 tests now drive the dossier from `brief-cameo`. The two
  focus assertions use `waitFor`, which is the test-visible shape of the `applyClose`
  frame-wait above. The "toggles closed on a second ♥ press" test is gone: no control on
  screen is a two-way toggle any more, and the replacement assertion is that the dossier's
  ← is what's there instead.
- `BriefRail.test.tsx` — the cameo's name, plus `brief-photo-input` asserted absent.
- `auth-context.test.tsx` — fixture grows `userName`; three tests expect `Ralf`/`Guest`.
- `demo-personas.test.ts`, `express-app.test.ts` — the `/api/config` persona shape.

`e2e/` needed **no** changes: grepping `e2e/tests` and `e2e/fixtures` for
`rail-profile-button`, `Her profile`, `brief-photo-input` and `brief-cameo` returns
nothing. Worth re-checking if that grep is ever made to pass through a page object.

Locally, `/api/config` serves `"name":"Samantha","userName":"Ralf"`. Note that a local run
has Cognito off (`authDisabled: true`), so the chip shows the dev-bypass label there — the
"Signed in as Ralf" path is exercised by `auth-context.test.tsx` and by a deployed
environment, not by `npm run dev`.

## Deferred — reasoning kept so it isn't rediscovered

- **`aria-pressed` on the cameo.** Rejected: it opens, it does not toggle, and the control
  unmounts with the surface it opened. A pressed state nothing can un-press is a lie to a
  screen reader.
- **Renaming `partner-profile-panel` → `brief-rail`.** Three unit tests and two Playwright
  specs still select the brief by the old alias. Out of scope here; still wants a QA-owned
  rename pass.
- **Making the dossier a route.** Still refused, for the reasons in `view-context.tsx`:
  reloading into an empty dossier is a poor cold start and would make `goto('/')`
  non-deterministic. The history entry `openDossier` pushes is not a router — the URL never
  changes and nothing is read back on mount.
- **Persona-aware demo toolbar.** Hiding by persona id would be more precise than "has
  seeded preferences", but it breaks the Reset affordance. Revisit only if a persona ever
  ships with zero preferences *and* wants the load button hidden.
