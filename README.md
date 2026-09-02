# Netflix Display Helper

Current version: **1.3.2**

A browser-only fix for black Netflix video with working audio on DisplayLink monitors. It forces Netflix video through Chrome's page compositor instead of the direct overlay that can appear black on macOS.

It does not modify Widevine DRM, access video frames, or change Chrome's global graphics settings. It can also move Chrome to a selected display and reload playback.

## Install in Chrome

1. Open `chrome://extensions` in Google Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `Netflix-Chrome-Plugin` folder.
5. Pin **Netflix Display Helper** from Chrome's Extensions menu.

Chrome will request permission to read display information and run on `netflix.com`. The extension does not collect or transmit data.

## Use it

1. Open the Netflix title in Chrome and start playback.
2. Click the extension icon.
3. Select the connected monitor.
4. Click **Move & retry** if needed.

Chrome moves the browser window almost full-screen onto that monitor and reloads the title. Netflix normally restores the saved playback position.

## Automatic browser-only DisplayLink fix

Version 1.3 applies an imperceptible CSS compositing layer to Netflix video at `document_start`. This makes Chrome composite the video with the web page instead of placing it on a direct hardware-overlay plane that DisplayLink presents as black on macOS.

The fix is limited to Netflix pages. Reload the extension and Netflix tab once to activate it.

## Is reconnecting required?

Usually, no. After installing or updating:

1. Reload the extension at `chrome://extensions`.
2. Reload the Netflix tab.

Only reconnect the DisplayLink monitor if the popup does not report **Browser fix active** after a reload. A Chrome extension cannot physically power-cycle a monitor.

If the picture is still black:

- **If you use DisplayLink on macOS:** reload the extension and Netflix tab so the automatic browser compositor fix runs. The popup will report **Browser display fix is active** when it has attached to the video.
- Connect the monitor directly to the computer; bypass docks, splitters, capture devices, and AV receivers.
- Try a different HDMI, USB-C, Thunderbolt, or DisplayPort cable and port.
- Confirm that every part of the connection supports HDCP (HDCP 2.2 is required for Ultra HD).
- Disconnect other displays, reconnect the target display, and try again.
- Use the extension's links to check protected-content settings and update Chrome.

Netflix's current guidance is at <https://help.netflix.com/en/node/11634>.
DisplayLink's protected-content limitation is documented at <https://support.displaylink.com/knowledgebase/articles/830301-content-protected-video-does-not-play-on-mac-while>.

## Development

No build step or dependencies are required.

```sh
npm test
npm run check
```

After changing a file, click the reload button for the extension on `chrome://extensions`, then reload the Netflix tab.

## Privacy and scope

- Runs only on `https://www.netflix.com/watch/*`.
- Reads player health information such as ready state, resolution, and media errors.
- Never reads account credentials, cookies, viewing history, or decrypted media.
- Stores only the ID of the last display selected in the extension popup.
