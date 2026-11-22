# Custom themes guide

A theme is a set of colours. You can make your own for the launcher and the client, and share it with friends.

## 1. What themes change

- The launcher changes straight away.
- The client uses your theme the next time it starts. Older client versions show Classic.
- Some plugin colours keep their own colours. Plugins from the Microbot Hub keep their own colours too.
- A custom theme made from Classic RuneLite is not identical to stock Classic. It is close, not the same.
- Older launchers show Gold in their Themes window and leave your theme alone until you pick something there. Your theme file stays safe.
- Light themes (a light background with dark text) can be hard to read in parts of the client, where some panels use white text. The editor warns you.

## 2. Make a theme in 1 minute

1. Open the menu and choose **Themes**.
2. Press **New theme**.
3. Type a **Name**. It can be up to 40 characters.
4. Choose a theme in **Start from**: Gold, Slate or Classic RuneLite.
5. Change the four colours: **Accent**, **Background**, **Panels** and **Text**. The small preview shows the result.
6. Press **Save**. Your new theme is picked straight away.

To change a theme later, press **Edit** next to it. If it is the theme you use, the change shows straight away.

## 3. Read the warnings

Warnings are shown under the colour pickers, for example "Text is hard to read on panels (3.2:1, aim for 4.5:1)."

The number is a contrast score. It says how well two colours stand apart. A higher number is easier to read. 4.5:1 is a good score for text, and 3:1 is enough for the accent.

A warning does not stop you saving. But if text is far too hard to read, the editor will not save the theme. It says: "This theme's text is too hard to read to use. Change Text or Background." The launcher will also not apply such a theme.

## 4. Share a theme

To send a theme:

1. Open **Themes**.
2. Press **Copy code** next to your theme. The button says "Copied".
3. Paste the code into Discord or a message.

To use a theme someone sent you:

1. Open **Themes** and press **Import theme**.
2. Paste the code, or paste the text of a theme file, into the box. You can also drag a theme .json file onto the window.
3. Press **Preview**. The launcher shows the theme and any warnings. Nothing is saved yet.
4. Press **Save as new theme**. If you already have a theme with that name, the new one is called "Name (2)". The window says "Saved as Name. Pick it in the list to use it."
5. Pick it in the Themes window.

You can also press **Save as file** next to a theme and send the file.

Very long codes and big files are refused. The limits are:

- a code: 8192 characters
- a theme file: 64 KB

A bigger one says "This theme code is too long." or "This file is too big to be a theme."

### Sharing a theme with a background image

Codes never carry images. When you copy the code of a theme with an image, the launcher tells you: "Background images are not included in codes. Send the image file too." When someone imports a theme file that uses an image, the launcher names it: "This theme uses the image midnight.png. Put that file in your themes folder."

1. Send the theme (code or file).
2. Send the image file as well.
3. The other player puts the image in their themes folder (see section 6), then imports the theme and picks the same image in the editor.

## 5. Go further: Advanced

In the editor, open **Advanced**.

- **Client colours** and **Launcher colours**: every colour, one by one. **Reset** puts one back to follow the basics.
- **Client: corner rounding**: 0 to 12. Shows "Off" at 0.
- **Client: round scrollbars**: on or off.
- **Client: scrollbar width**: 4 to 17. Shows "Default" until you change it.
- **Background image**: choose a picture for the launcher background, or **None**. Put .png, .jpg, .jpeg or .webp files in your themes folder first. Each image can be up to 5 MB and 8192 pixels wide or tall.
- **Image strength**: 0 to 60 %. Higher shows more of the picture.

Hover a colour name to see its key in the file.

### What each client colour paints

| Name in the editor | Key in the file |
| --- | --- |
| Accent | `accent` |
| Cards and title bar | `darker` |
| Panel background | `dark` |
| Lines and selection | `medium` |
| Muted text | `light` |
| Text | `text` |
| Buttons and inputs | `control` |
| Borders | `border` |
| Card hover | `darkerHover` |
| Panel hover | `darkHover` |
| Scrollbar track | `scrollTrack` |

### What each launcher colour paints

| Name in the editor | Key in the file |
| --- | --- |
| Page | `bg` |
| Sidebar | `surface` |
| Cards | `surface-2` |
| Hover | `surface-3` |
| Lines | `line` |
| Strong lines | `line-strong` |
| Dividers | `line-mid` |
| Dialog shade | `shade` |
| Text | `text` |
| Headings | `text-strong` |
| Muted text | `muted` |
| Faint text | `faint` |
| Accent | `gold` |
| Accent hover | `gold-hover` |
| Soft accent | `gold-soft` |
| Text on accent | `on-gold` |
| Red | `red` |
| Red text | `red-text` |
| Green | `green` |

## 6. Edit the file by hand

Press **Open themes folder** in the Themes window. Each theme is one .json file there.

The folder is:

- Windows: `%USERPROFILE%\.microbot\themes`
- macOS and Linux: `~/.microbot/themes`

Example:

```json
{
  "format": 1,
  "name": "Midnight",
  "base": "slate",
  "colors": { "accent": "#7aa2f7", "background": "#11131a", "panel": "#1a1d27", "text": "#e3e6ec" },
  "client": { "border": "#0b0c10" },
  "launcher": { "red": "#ff5555" },
  "style": { "corners": 6, "roundScrollbars": true, "scrollbarWidth": 8 },
  "background": { "image": "midnight.png", "strength": 30 }
}
```

What each field means:

- `format`: always `1`.
- `name`: the only field you must have. Up to 40 characters.
- `base`: `gold`, `slate` or `classic`. Anything else becomes `classic`.
- `colors`: the four basics (`accent`, `background`, `panel`, `text`). The launcher works out the other colours from them.
- `client`: single client colours that win over the basics. Keys are in the first table above.
- `launcher`: single launcher colours that win over the basics. Keys are in the second table above.
- `style`: `corners` (0 to 12), `roundScrollbars` (`true` or `false`), `scrollbarWidth` (4 to 17). Numbers outside the range are moved to the nearest allowed number.
- `background`: `image` is a file name in the same folder, ending in .png, .jpg, .jpeg or .webp. `strength` is 0 to 60 and defaults to 30.

Rules:

- Write colours as `#rrggbb` only, for example `#7aa2f7`. Nothing else works.
- Anything missing or wrong falls back to the base theme, one key at a time.
- Keys the launcher does not know are ignored.
- The file name uses only a-z, 0-9 and -, like `midnight.json`. Otherwise the list says: "Rename this file using only a-z, 0-9 and -, like midnight.json."
- The image must be in the same folder. Use the file name only, no folders.

## 7. Safety

- A theme holds only colours, a name and a few numbers.
- A code cannot run anything. The launcher checks every value and ignores what it does not understand.
- Images never travel in codes. The launcher only opens an image if it really is a PNG, JPEG or WebP picture, is 5 MB or smaller, and is not too big on screen:

  - at most 8192 pixels wide or tall
  - at most 40 million pixels in all

## 8. Something is wrong

- **My theme is not in the list.** A file with a problem is shown in the list with the reason. Fix the file, or save the theme again from the editor.
- **"Your theme file is gone; pick another theme."** The file was moved or deleted. Pick another theme.
- **The client did not change.** Restart the client. It reads the theme when it starts. Older client versions show Classic.
- **My background image does not show.** Check that it is in the themes folder, ends in .png, .jpg, .jpeg or .webp, is 5 MB or smaller, is at most 8192 pixels wide or tall, and has at most 40 million pixels in all.
- **Back to normal.** Open **Themes** and pick **Gold**. Gold is the launcher's own look. If the launcher will not open the Themes window at all, close the launcher and delete `theme.json` in the .microbot folder (one level above `themes`). Your theme files in `themes` are not touched.
