# Sticky Notes

Current version: **1.0.0**

Pin sticky notes anywhere on any web page. Notes are saved in Chrome's local extension storage and reappear in the same spot every time you come back to that page, in any tab.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `sticky-notes` folder.
5. Pin **Sticky Notes** to the toolbar.
6. Reload any pages that were already open.

## Use

Add a note in any of three ways:

- Click the toolbar icon and press **Add Note**.
- Right-click the spot on the page you want the note and choose **Add sticky note here**. Selected text becomes the note's first line.
- Press **⌥⇧N** (Alt+Shift+N). Change it at `chrome://extensions/shortcuts`.

The note works like a macOS Stickies window:

- Drag the darker bar on top to move it. Notes are anchored to the page, so they scroll with the content.
- Drag the grip in the bottom-right corner to resize it.
- The bar has a trash button on the left, and a colour menu and collapse button on the right. Deleting shows a five-second **Undo**.
- The pull-down in the footer chooses where the note shows: **This Page**, or **All of** that site. A site is the full host, so `mail.google.com` and `docs.google.com` are separate sites.
- A brief **Saved** appears after every change. Press **Escape** to leave the note.

The toolbar badge shows how many notes are on the current page. The popup lists every note you have, anywhere. Use the pop-up button to show notes visible on this page, all notes on this site, all notes, or any single site. Search filters by text, host, or path. Click a note to scroll to it, or to open its page if it lives elsewhere. Deleting one note offers **Undo**. Deleting the whole list asks first. The popup follows your system's light or dark appearance.

## How it works

- `content.js` draws the notes inside a Shadow DOM overlay so page styles and note styles never touch. Notes are stored with document coordinates, and every edit, move, resize, colour change and collapse is written back within a third of a second.
- `notes-store.js` is the shared, dependency-free logic: it turns a URL into a stable page key (hash and tracking params such as `utm_*` are ignored, so `page#section` and `page?utm_source=x` share notes) and a site key (the origin), and validates everything read from storage.
- `background.js` owns the context menu, the keyboard shortcut and the badge.
- Storage is `chrome.storage.local`: one key per page (`notes:<page>`) and one per site (`site:<origin>`). A page renders both. Writes are read-modify-write and tabs listen for changes, so two tabs on the same page stay in sync. Single-page apps are handled by watching the URL.

## Privacy

Everything stays on your machine. The extension makes no network requests and has no analytics. Uninstalling it removes all notes.

## Development

```sh
npm run check   # syntax check every script
npm test        # unit tests for the store and manifest
```
