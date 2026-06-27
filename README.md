# Custom Chat Overlay

This project is a static Twitch chat overlay for OBS. It is served locally and used as one or more OBS browser sources.

[ technical part was vibe coded, css visuals coded by me ]

## Files You Actually Use

- `chat.html`: main chat overlay
- `streamer.html`: streamer-only overlay
- `js/overlay-common.js`: shared Twitch/chat runtime
- `css/overlay.css`: shared styling
- `config/shared.json`: channel-wide settings
- `config/chat.json`: main overlay settings
- `config/streamer.json`: streamer overlay settings

## Start The Local Server

Run the project directory through Python's static server:

```bash
python -m http.server 8080 --directory "path-to-the-chat-folder"
```

Or just use Apache server from XAMPP

## OBS Browser Source URLs

Use these URLs in OBS:

- Main chat: `http://127.0.0.1:8080/chat.html`
- Streamer messages: `http://127.0.0.1:8080/streamer.html`

Set the browser source background to transparent.

## Config Files

### `config/shared.json`

- `channel`: your Twitch channel login, without `#`
- `sevenTvUserId`: your 7TV user ID for channel emotes

### `config/chat.json` and `config/streamer.json`

- `maxMessages`: maximum number of visible messages in that overlay
- `transparency`: bubble opacity from `0` to `1`
- `scale`: visual scale of the overlay
- `disappearTimeMs`: auto-remove delay in milliseconds
  - `0` means messages stay until trimmed or moderated away
- `fromTop`: `true` makes the overlay start at the top and grow downward; `false` keeps it anchored at the bottom
- `alignRight`: streamer overlay only; `true` anchors message bubbles to the right side instead of the left
- `fadeOldMessages`: streamer overlay only; `false` disables the older-message transparency fade near `maxMessages`
- `emojiOnlyScale`: streamer overlay only; scales messages that contain only emotes or emoji, without any other text

The two overlay config files are separate on purpose, so your streamer-only source can use different limits or timing than the main chat source.

## Behavior

- Normal chat messages render from Twitch IRC over websocket.
- Your own messages are recognized by matching the sender login to `config/shared.json -> channel`.
- Your messages appear in both overlays.
- The streamer-only overlay shows only your messages.
- The streamer-only overlay hides the nickname bubble and renders only the message bubble.
- Older streamer-only messages become more transparent as the overlay fills toward `maxMessages`.
- If Twitch deletes one message, the overlay removes that exact message.
- If Twitch times out or bans a user, the overlay removes all currently visible messages from that user.
- If Twitch clears the chat room, the overlay clears visible messages.
- Twitch native emotes, 7TV emotes, and FFZ emotes are supported.

## Common Changes

### Change the channel

Edit `config/shared.json`:

```json
{
  "channel": "your_channel_name",
  "sevenTvUserId": "your_7tv_user_id"
}
```

### Make messages disappear automatically

Set `disappearTimeMs` in the overlay config you want to change:

```json
{
  "maxMessages": 15,
  "transparency": 1,
  "scale": 1,
  "disappearTimeMs": 12000,
  "fromTop": false,
  "alignRight": false,
  "fadeOldMessages": true,
  "emojiOnlyScale": 1
}
```

That example removes messages after 12 seconds.

## Troubleshooting

### Page loads but no chat appears

- Confirm the local server is running on port `8080`
- Confirm OBS is loading `http://127.0.0.1:8080/...`, not a `file://` path
- Confirm `config/shared.json` has the right `channel`

### Overlay shows an error box

- Open the page in a browser and check the developer console
- The most common cause is a missing or invalid JSON config file

### Emotes do not appear

- Check internet access from the OBS/browser source machine
- Confirm `sevenTvUserId` is correct for your channel emotes
- FFZ and 7TV failures are logged in the browser console

### Deleted or banned messages stay on screen

- Refresh the browser source after updating the files
- Make sure the overlay is using the new `chat.html` or `streamer.html`
- Twitch moderation removal only applies to messages currently visible in the overlay
