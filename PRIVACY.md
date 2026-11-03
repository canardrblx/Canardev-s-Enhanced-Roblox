# Privacy Policy — Canardev's Enhanced Roblox

Last updated: 2026-11-03

Canardev's Enhanced Roblox (CER) is a browser extension that restyles the Roblox
website. This policy explains exactly what it does with data. The short version:
everything runs on your own device, and nothing is tracked or sold.

## What CER does on your device

- CER reads and restyles the pages on roblox.com so they look and work the way
  the extension designs them.
- To fill in the redesigned pages (your friends, games, avatar, Robux, and so
  on) CER calls Roblox's own website APIs using the login you already have in
  your browser. This is the same data Roblox's own pages show you. It is used
  only to draw the page in front of you and is not stored or sent anywhere else.
- Your settings (theme, toggles) and your local playtime totals are saved on your
  device using the browser's local storage. They never leave your device.
- Playtime: about once a minute CER asks Roblox (with your login) whether you
  are in a game, and adds the minutes to your local totals. This request goes
  only to Roblox, and the totals stay on your device.
- Preferred-region join: when you choose to join a server in a region, CER asks
  Roblox's own server list and join service about up to 15 servers to find one
  in that region. These requests go only to Roblox, only when you start the
  search, and stop when you cancel it.

## The one thing that can leave your device

CER has an optional feedback box. If you choose to type a message and press send,
CER sends one message to the developer's private Discord channel, so the
developer can read your feedback. It contains exactly:

- the kind you picked (Bug, Idea or Other),
- your Roblox username and user id (or "unknown user" if you are signed out),
- the CER version number,
- the text you typed (up to about 1900 characters).

Nothing else is attached, and mentions such as @everyone are switched off. This
only happens when you press send, at most once every 10 minutes. If you never
use the feedback box, nothing is ever sent off your device.

Developer copies only: if you load CER yourself from its source code (not from
a browser store), it also asks GitHub every few hours whether a newer version
exists. GitHub sees that request (your IP address and browser) like any web
request. Store versions never make this request.

## What CER does NOT do

- No analytics, telemetry, tracking pixels, or advertising.
- No selling, renting, or sharing of your data with anyone.
- No collecting of passwords, payment details, or personal information.
- No reading of pages other than roblox.com.

## Permissions and why

- Access to roblox.com: to read and restyle Roblox pages and load your Roblox
  data (through Roblox's own APIs, with your existing login) so the new pages
  can be shown.
- Access to a Discord webhook address: used only to deliver the text you type in
  the feedback box to the developer. Nothing else is sent to it.
- Access to api.github.com: only for the developer-copy version check described
  above. Store versions never use it.
- Storage: to save your theme, settings, and local playtime on your device.
- Alarms: to update the local playtime tracker about once a minute.

## Children

CER does not knowingly collect personal information from anyone, including
children. The only information that can be sent is what a user chooses to type
into the feedback box.

## Changes

If this policy changes, the "last updated" date above will change and the new
version will be posted here.

## Contact

For questions about this policy, use the feedback box in the extension or open an
issue on the project's GitHub page.
