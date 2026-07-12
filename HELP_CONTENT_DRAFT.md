# Help Center — starter content draft (Loadout)

> Drop-in content for `src/data/help.ts` (`HELP_CONTENT_SEED`), matching Blue Seal's shape: **categories** `{id,title,description,icon}`, **articles** `{slug,categoryId,title,audience,popular?,body(markdown)}`, **faqs** `{categoryId,question,answer,audience}`. Audiences: `all | crew | tourManager | artist`. Slugs are unique, lowercase-kebab, stable once shipped.
>
> This is a **starter** — the foundational articles are written in full; the rest are stubbed titles the agent fills in **as each feature ships** (the §19 per-feature Help upkeep rule). Keep copy qualitative on pricing until numbers are live.

---

## Categories
| id | title | description | icon |
|---|---|---|---|
| `getting-started` | Getting started | Create an account, find your way around, and how Loadout works. | `pi pi-compass` |
| `building-a-tour` | Building a tour | For tour managers: create tours, days, schedule, venues, and invite crew. | `pi pi-calendar-plus` |
| `on-the-road` | On the road | For crew: your day, itinerary, guest requests, notifications, offline. | `pi pi-map` |
| `travel-logistics` | Travel & logistics | Flights, hotels, ground transport, rooming lists. | `pi pi-send` |
| `advancing-daysheets` | Advancing & day sheets | Advance shows, stage plots & tech packs, day sheets and reports. | `pi pi-file-edit` |
| `money` | Budget & settlement | Tour budget, per-show settlement, per-diems, merch, exports. | `pi pi-wallet` |
| `ai-tools` | AI tools | The assistant, and turning emails/PDFs into schedule items. | `pi pi-sparkles` |
| `community-map` | Map & community | The map, band notes & recommendations, profiles, who's in town. | `pi pi-globe` |
| `privacy-visibility` | Privacy & visibility | Control who sees what — items, financials, and your band. | `pi pi-lock` |
| `account-billing` | Account, app & billing | Profile, roles, installing the app, notifications, and Premium. | `pi pi-cog` |

---

## Articles (foundational — written in full)

### `what-is-loadout` · getting-started · all · popular
**What is Loadout?**
Loadout is the shared home base for running a live tour. A tour manager builds the tour once — dates, venues, crew, travel, schedule — and everyone on the road carries the whole thing in their pocket, **even with no internet**. When something changes, it updates for everyone and pings their phone. It also has a **map-based community** where bands share on-the-ground tips about venues, restaurants, and cities. It works on any phone, tablet, or computer — no App Store needed; just add it to your home screen.

### `create-an-account` · getting-started · all · popular
**Creating your account**
Sign up with your email or Google account. You'll start as **crew** — able to see any tour you're invited to. If you run tours, add the **tour manager** role from your account settings; if you're an artist, add the **artist** role. You can hold more than one role and switch between them anytime — the app shows the right view automatically.

### `roles-explained` · getting-started · all
**Roles: tour manager, artist, crew, accountant**
- **Tour manager** — builds and runs tours; can manage several bands and tours.
- **Artist** — owns their band(s) and tours.
- **Crew** — sees the tours they're invited to, gets notified of changes, and can request guest-list spots. Crew are always free.
- **Accountant** — the only non-owner role that can see and edit the money (budget & settlement).
Access is per-tour: you might be a manager on one tour and just crew on another.

### `create-a-tour` · building-a-tour · tourManager · popular
**Building a tour from scratch**
1. Create a **Band**, then a **Tour** under it with a start and end date — Loadout creates a day for each date.
2. Set each day's type: **Show**, **Travel**, **Off**, or **Press/Promo**.
3. Add the **venue** (start typing — we auto-fill the address, contacts, and details).
4. Add your **schedule** (load-in, sound check, doors, set, load-out) and **travel** (flights, hotels, ground).
5. Add your **personnel** and **invite crew** by email or a one-tap link.
6. Generate a **day sheet** and you're live. Change anything later and everyone's phone updates.

### `invite-crew` · building-a-tour · tourManager
**Inviting your crew**
Invite people by email or share a one-tap join link. They join as **crew** by default (you can make someone a manager or accountant). Crew are free — invite the whole touring party without worrying about seats. You control what each person can see with **visibility** (see *Privacy & visibility*).

### `your-day-on-the-road` · on-the-road · crew · popular
**Your day, at a glance**
Open Loadout and you land on **today**: the venue and address (tap for directions), your call time, load-in/sound check/set times, your hotel, and the weather. Swipe to any other day to see the full plan. Everything you see here **works offline** — if you're in a basement venue with no signal, it's still there.

### `offline` · on-the-road · all · popular
**Does it work with no internet?**
Yes. Once your device has loaded a tour, the schedule, venue, travel, and day sheet stay available **offline**. If you're a manager and make edits offline, they're saved and sync automatically when you're back online. A "last synced" note tells you how fresh your copy is.

### `guest-list-requests` · on-the-road · crew
**Requesting guest-list spots**
Open the show's guest list and add your names. Each person may have a cap (e.g. +2) and a cutoff time. Your request goes to the tour manager to approve — you'll get a notification when it's decided.

### `stage-plots-share-links` · advancing-daysheets · tourManager · popular
**Stage plots, tech packs & sending them to a venue**
Attach your stage plot, input/channel list, and tech rider to a tour. To send them to a venue or promoter, generate a **public share link** — a read-only web page they can open without an account. You can **revoke** a link anytime, and it only ever shows that pack, nothing else about your tour.

### `day-sheets` · advancing-daysheets · tourManager
**Day sheets & reports**
Generate a single-day day sheet or a multi-day "tour book" from a template, export to PDF, and share it. Day sheets pull live from your tour, so they're always current — no more emailing a new PDF every time a time changes.

### `budget-and-settlement` · money · tourManager
**Budget & settlement**
Track a whole-tour **budget** (what you plan to spend vs. what you actually spend), settle each show on the night (tickets, comps, merch, expenses → profit/loss), and export to PDF or a spreadsheet for your accountant. Money is visible only to owners and accountants.

### `ai-tools-overview` · ai-tools · all
**What the AI tools do**
Forward a hotel or flight confirmation, or drop in a rider PDF, and Loadout turns it into schedule and travel entries you confirm with a tap. Ask the assistant things like "what's tonight's load-in time?" and it answers from your tour. *AI tools are part of Premium.*

### `community-overview` · community-map · all · popular
**The map & community**
Loadout has a map of venues, restaurants, and things to do, with tips left by other bands — "load-in's down the alley," "best late-night food nearby," "green-room wifi." Leave your own notes, keep recommendations, and (if you opt in) see who else is in town. *Community access is part of Premium.*

### `visibility-and-privacy` · privacy-visibility · all · popular
**Controlling who sees what**
Two layers: your **role** decides what you can do; **visibility** decides which items you can see. Managers can hide specific items (like financial docs or a surprise-guest plan) from selected people. Your private tour data is **never** shown in the community. On the community side, your band is **invisible until you opt in**, and presence is **city-level only — never your live location**.

### `install-the-app` · account-billing · all
**Installing Loadout on your phone**
Loadout is a web app that installs like a normal one. In your browser, choose **Add to Home Screen** — you'll get an icon, full-screen, and offline support, with no App Store needed. Works on iPhone, Android, iPad, Mac, and Windows.

### `premium-and-billing` · account-billing · all
**Free vs Premium**
The core of Loadout — building and running tours, day sheets, crew, guest lists, basic travel — is **free**. **Premium** unlocks the AI tools, the map & community, and advanced privacy controls. You can subscribe and manage billing in your account settings.

---

## Articles (stubs — fill in as each feature ships, §19)
`switching-roles` · `travel-flights` (flight tracking + auto-reroute alerts) · `travel-hotels-rooming` · `travel-ground-drive-times` · `advancing-checklist` · `merch-counts` · `weather-traffic-on-daysheet` · `visa-carnet-tracker` · `band-profile` · `who's-in-town-presence` · `gear-backline-sharing` · `notifications-and-reminders` · `import-from-master-tour` · `export-to-quickbooks-xero` · `manage-your-account-data` (export/delete) · `admin-managing-users` (admin).

---

## FAQs
| categoryId | audience | question | answer |
|---|---|---|---|
| getting-started | all | Is Loadout free? | The core tour-management tools are free. AI, the map/community, and advanced privacy controls are part of Premium. Crew are always free. |
| getting-started | all | Do I need to download it from an app store? | No. Open it in your browser and choose "Add to Home Screen" — it installs like a normal app and works offline. |
| getting-started | all | What devices does it work on? | Any phone, tablet, or computer — iPhone, Android, iPad, Mac, Windows. One version everywhere. |
| on-the-road | crew | Does it work without internet? | Yes — once a tour is loaded, your schedule, venue, travel, and day sheet stay available offline and sync when you reconnect. |
| on-the-road | crew | How will I know if something changes? | You get a push notification, and your day updates automatically. |
| building-a-tour | tourManager | Can I run more than one band or tour? | Yes — one account can manage many bands and tours. |
| building-a-tour | tourManager | Do I pay per crew member? | No. Crew are free; invite the whole touring party. |
| building-a-tour | tourManager | Can I import my existing tour from Master Tour? | Yes — you can import your Master Tour data to get started quickly. |
| advancing-daysheets | tourManager | Can a venue see my stage plot without an account? | Yes — generate a read-only public share link. It's revocable and shows only that pack. |
| money | tourManager | Who can see the money? | Only owners and accountants can see and edit budgets and settlements. Crew never can. |
| money | tourManager | Can I export for my accountant? | Yes — export budgets and settlements to PDF and a spreadsheet (QuickBooks/Xero-friendly). |
| ai-tools | all | What can the AI actually do? | Turn forwarded confirmations/PDFs into schedule and travel entries, draft day sheets, and answer questions about your tour. |
| ai-tools | all | Is my data used to train AI? | No — the AI reads your tour data only to help you; it isn't used to train models. (Confirm exact wording with the Privacy Policy.) |
| community-map | all | Can other bands see my tour? | No. Your private tour data is never shown in the community. Only what you choose to make public (your profile, posts) is visible, and map presence is opt-in and city-level. |
| community-map | all | Is the community free? | Community access is part of Premium. |
| privacy-visibility | all | Can I hide certain details from some crew? | Yes — managers can set item-level visibility so sensitive items are only seen by selected people. |
| privacy-visibility | artist | Can I stay unlisted? | Yes — your band is invisible in the community until you opt in, and advanced privacy controls let you lock down who can find you. |
| account-billing | all | How do I cancel Premium? | Manage or cancel your subscription anytime in account settings. |
| account-billing | all | Can I export or delete my data? | Yes — request a data export or account deletion from account settings. |
| account-billing | all | I found a bug / need help — what do I do? | Use the in-app support option to send us a ticket; we'll reply by email. |
