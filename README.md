<p align="center">
  <img src="assets/logo.png" width="110" alt="CER logo">
</p>

<h1 align="center">Canardev's Enhanced Roblox</h1>

<p align="center">A free browser extension that makes roblox.com look and feel a whole lot better.</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/canardevs-enhanced-roblox/dlocfeligcnnmknnnmainkdbmpoaficc"><b>Chrome Web Store</b></a>
  &nbsp;·&nbsp;
  <a href="https://addons.mozilla.org/en-US/firefox/addon/canardev-s-enhanced-roblox/"><b>Firefox Add-ons</b></a>
</p>

---

I'm canardev and I make Roblox games (you might have played Build a Country).
Every Roblox extension I tried did cool stuff but phoned home to servers I
couldn't see, so I built my own and kept it fully open.

It only talks to roblox.com. No backend, no analytics, no accounts. Every line
is in this repo and there's no build step, so the code you read is the code that
runs.

> **Heads up:** this is still in active development and nowhere near finished.
> Expect rough edges, missing bits, and frequent updates.

## What it does

**Themes.** A big pile of them, plus animated ones like Aurora and Ember drawn
in pure CSS. Dark themes recolor every corner of the site, not just the homepage.

**Redesigned pages.** Home, profile, game pages, groups, friends, messages,
settings, the avatar editor and the games page all get cleaner layouts. The
profile has proper tabs (About, Creations, Favorites, Friends, Groups, Badges),
the games page is trimmed down to Top Games, a rotating genre carousel and my
daily picks, and the avatar editor lets you stack more accessories than Roblox's
own UI allows.

**Quality of life.** A search dropdown across games, people, catalog and groups.
Presence rings on avatars so you can tell at a glance who's online, in game or in
Studio. A local playtime tracker with a heatmap. A better server browser. Cleaner
game titles. Communities renamed back to Groups. Hideable home rows. Almost
everything is a toggle in the CER Settings panel.

## Screenshots

Every theme repaints the whole site. Here is the home page and a game page in
Roblox's own Dark and Light, with a few custom themes below.

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/robloxdark/home.png" alt="Home, Roblox Dark"></td>
    <td width="50%"><img src="assets/screenshots/robloxdark/games.png" alt="Game page, Roblox Dark"></td>
  </tr>
  <tr>
    <td><img src="assets/screenshots/robloxlight/home.png" alt="Home, Roblox Light"></td>
    <td><img src="assets/screenshots/robloxlight/games.png" alt="Game page, Roblox Light"></td>
  </tr>
</table>

<details>
<summary><b>Roblox Dark</b></summary>

![Home](assets/screenshots/robloxdark/home.png)
![Games](assets/screenshots/robloxdark/games.png)
![Profile](assets/screenshots/robloxdark/profile.png)
![Avatar](assets/screenshots/robloxdark/avatar.png)
![Friends](assets/screenshots/robloxdark/friends.png)
</details>

<details>
<summary><b>Roblox Light</b></summary>

![Home](assets/screenshots/robloxlight/home.png)
![Games](assets/screenshots/robloxlight/games.png)
</details>

<details>
<summary><b>Grape</b></summary>

![Home](assets/screenshots/grape/home.png)
![Games](assets/screenshots/grape/games.png)
![Profile](assets/screenshots/grape/profile.png)
![Avatar](assets/screenshots/grape/avatar.png)
![Friends](assets/screenshots/grape/friends.png)
</details>

<details>
<summary><b>Ocean</b></summary>

![Home](assets/screenshots/ocean/home.png)
![Games](assets/screenshots/ocean/games.png)
![Profile](assets/screenshots/ocean/profile.png)
![Avatar](assets/screenshots/ocean/avatar.png)
![Friends](assets/screenshots/ocean/friends.png)
</details>

<details>
<summary><b>Cotton Candy</b></summary>

![Home](assets/screenshots/cotton/home.png)
![Games](assets/screenshots/cotton/games.png)
![Profile](assets/screenshots/cotton/profile.png)
![Avatar](assets/screenshots/cotton/avatar.png)
![Friends](assets/screenshots/cotton/friends.png)
</details>

<details>
<summary><b>Forest</b></summary>

![Home](assets/screenshots/forest/home.png)
![Games](assets/screenshots/forest/games.png)
</details>

## Install

- **Chrome / Edge / Brave:** [Get it on the Chrome Web Store](https://chromewebstore.google.com/detail/canardevs-enhanced-roblox/dlocfeligcnnmknnnmainkdbmpoaficc)
- **Firefox:** [Get it on Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/canardev-s-enhanced-roblox/)

Prefer to run it straight from source? Clone the repo, then in Chrome open
`chrome://extensions`, turn on Developer mode, and **Load unpacked** the
`extension/` folder. Firefox: load `firefox-build/manifest.json` as a temporary
add-on from `about:debugging`.

## Why you can trust it

Don't take my word for it, check for yourself:

- Everything is in this repo. No minified blobs, no build output, no
  dependencies.
- Search the code for `fetch`. Requests go to roblox.com domains.
- Permissions: `storage` (your settings), `alarms` (the playtime tracker), and
  roblox.com pages.
- GPL-3.0 licensed, so it stays open.

Find something sketchy? Open an issue and roast me.

## License

GPL-3.0, see [LICENSE](LICENSE).

*Not affiliated with Roblox Corporation. Roblox is a trademark of Roblox
Corporation.*
