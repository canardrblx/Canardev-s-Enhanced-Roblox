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

It only talks to roblox.com (plus the feedback box, if you use it). No backend,
no analytics, no accounts. Every line is in this repo and there's no build step,
so the code you read is the code that runs.

> **Heads up:** this is still in active development and nowhere near finished.
> Expect rough edges, missing bits, and frequent updates.

## What it does

**Every page, redesigned.** Home, games, game pages, search, profiles, friends,
groups and the group manager, catalog, avatar editor, messages, badges, passes,
inventory, favorites, trades, transactions, account settings and even the 404
page. Clean layouts, big art, no clutter.

**Themes.** Midnight, Galaxy, Ocean, Forest, Lava, Black, Cloud, Bubblegum, Mint
and Sunny, plus Roblox's own Light and Dark. Pick one and the whole site follows.

**Quality of life.** Verified, Premium and Plus badges on every name. Pin games
to Home. Sort friend requests by mutual friends, followers or verified. Select
all in messages. A search dropdown across games, people, catalog and groups.
Presence rings on avatars. A local playtime tracker. Communities renamed back to
Groups.

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
<summary><b>Galaxy</b></summary>

![Home](assets/screenshots/galaxy/home.png)
![Games](assets/screenshots/galaxy/games.png)
![Profile](assets/screenshots/galaxy/profile.png)
![Avatar](assets/screenshots/galaxy/avatar.png)
![Friends](assets/screenshots/galaxy/friends.png)
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
<summary><b>Bubblegum</b></summary>

![Home](assets/screenshots/bubblegum/home.png)
![Games](assets/screenshots/bubblegum/games.png)
![Profile](assets/screenshots/bubblegum/profile.png)
![Avatar](assets/screenshots/bubblegum/avatar.png)
![Friends](assets/screenshots/bubblegum/friends.png)
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
`extension/` folder. Firefox: run `./build-firefox.sh`, then load
`firefox-build/manifest.json` as a temporary add-on from `about:debugging`.

## Why you can trust it

Don't take my word for it, check for yourself:

- Everything is in this repo. No minified blobs, no build output, no
  dependencies.
- Search the code for `fetch`. Requests go to roblox.com domains. The one
  exception is the feedback box: when you press Send, your message and Roblox
  username go to my Discord.
- Permissions: `storage` (your settings), `alarms` (the playtime tracker), and
  roblox.com pages.
- GPL-3.0 licensed, so it stays open.

Find something sketchy? Open an issue and roast me.

## License

GPL-3.0, see [LICENSE](LICENSE).

*Not affiliated with Roblox Corporation. Roblox is a trademark of Roblox
Corporation.*
