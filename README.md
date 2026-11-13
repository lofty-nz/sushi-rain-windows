# Sushi Rain

**Write inside the digital rain.** A full-screen note-taking toy where the falling code
runs through your words, and every note you send becomes its own stream in the rain.

![The rain, with notes falling in their own glowing lines and a sentence being typed in the middle](docs/rain.jpg)

The famous falling code from *The Matrix* was, by its designer's own account, made from
characters scanned out of Japanese cookbooks, sushi recipes included. So here the rain is
mirrored half-width katakana, and some columns quietly carry a real sushi recipe.

- A blinking cursor made of rain code waits in the middle of the screen.
- What you type sits in a highlighted band. The rain keeps falling through it: letters flicker
  out and get replaced by code for a moment, but most stay right, so you can still read it.
- **Enter sends it into the rain as a note.** The letters fly up into a column at a random spot,
  and from then on that column rains your note. No two notes share a column until every column
  is taken; after that, extra notes join a column as another stream.
- **N** shows all your notes with the time each was added, with a box to tick them off.
  Ticked-off notes stop raining.
- Notes live in a plain text file, `notes.txt`, that you can open and edit yourself.
- Notes can show in English or in "sushi": sounded out in katakana (`buy milk` → ﾌﾞｲ ﾐﾙｸ).
- **S** opens quick settings: rain speed, density and trail length, letter flicker, what the
  rain is made of (katakana, binary, hex, or actual 🍣), rain that falls *up*, disco colours.

No dependencies beyond Python 3 and a browser. No build step, nothing leaves your computer.

This is the **Windows build**: the same app, run locally with Python. The Linux screensaver is not
included.

| The notes list (N) | Import a list | Sushi mode, falling up |
|---|---|---|
| ![Notes list with tick boxes and the time each note was added](docs/notes-list.jpg) | ![Import box with a pasted list of notes](docs/import.jpg) | ![Rain made of sushi emoji, falling upwards](docs/sushi-mode.jpg) |

## Run it (Windows)

You need [Python 3](https://www.python.org/downloads/windows/) and a browser. During the Python
install, tick **Add python.exe to PATH**.

Double-click **`run.cmd`** — it starts the server in its own window and opens the page. Or, from a
Command Prompt in this folder:

```bat
py -3 server.py
```

Then open **http://127.0.0.1:8777/** in Firefox, Edge or Chrome. The server only listens on your own
computer and keeps your notes in `notes.txt` next to it.

You can also just open `index.html` straight from the folder: everything works, but notes are then
kept in the browser instead of `notes.txt`.

To stop the server, close its window or press Ctrl+C.

## Keys

| Key | Does |
|---|---|
| Type | Writes, centred on the screen |
| **Enter** | Sends what you typed into the rain as a note |
| Shift+Enter | New line inside a note |
| **N** (nothing typed) or Alt+N | The notes list: Space/Enter ticks off, Delete twice removes, Ctrl+I imports |
| **S** (nothing typed) or Alt+S | Quick settings: ↑↓ choose, ←→ change |
| F8 | Notes in English → sushi → both |
| Esc (or F1) | Menu: all settings, save/open, import, keys |
| F2 | Sound on/off (synthesised key clicks and a quiet rain; off to start) |
| F4 | The sushi recipe in the rain: Japanese → English → both → off |
| Ctrl+S / Ctrl+O | Save the page as a .txt / open a .txt |
| Ctrl+Z, arrows, Home/End, Ctrl+A/C/X/V | What you'd expect |
| Type the word "sushi" | 🍣 |

The empty page stays clean: press a key that doesn't type anything (Enter, an arrow, Backspace) and a
short reminder of the main keys appears for 5 seconds, or until the next key press.

N and S only open when nothing is typed. If you just keep typing, they close again and your
letters go onto the page (the N or S included), so a note can still start with those letters.

## Notes

`notes.txt` has one note per line:

```
[ ] 2026-11-13 17:42:05  buy milk
[x] 2026-11-13 17:45:31  call the plumber  (done 2026-11-13 18:02:10)
```

`[ ]` still rains, `[x]` is ticked off. Edit it while the app is open and the changes appear within a
few seconds; a line typed without the `[ ]` part becomes a new note. Which column each note rains in is
kept in `.notes-lines.json`.

**Import** (N list → *Import…*, or Esc → *Your notes*): paste a list or pick a .txt file, one note per
line. Blank lines are skipped, bullets and numbers at the start (`- `, `* `, `• `, `1. `) are tidied
away, lines in `notes.txt`'s own format keep their tick, and notes you already have can be skipped.

"Sushi" is a playful sound-it-out of English into half-width katakana, the way loanwords are written
in Japanese (`test` → ﾃｽﾄ, `milk` → ﾐﾙｸ). It is not a translation.

## Settings and URL options

Everything in the menus is a setting, kept in the browser. For a single visit you can override any of
them in the address, e.g. `?theme=amber&glitch=0.8&glyphSet=binary&reverse=1` (never saved). Also:

- `fresh=1` starts empty with no notes and saves nothing (handy for trying things out)
- `demo=Hello%5Cnworld` types that by itself (`\n` = new line), `cps=20` sets the speed
- `menu=1` opens the menu at start

## How it's built

Plain HTML, CSS and JavaScript (no framework, no build), drawn on one canvas character grid, so the
rain columns line up exactly with the letters you type. A small Python standard-library server serves
it and reads/writes `notes.txt`.

| File | What it does |
|---|---|
| `index.html` | The page |
| `core.js` | Rain engine, editor (a hidden textarea, so undo, clipboard and IME work), flickering text, cursor, settings, plugin API |
| `quick.js` | The S quick-settings strip |
| `notelist.js` | The N notes list |
| `importer.js` | Import notes from a list |
| `notes.js` | Notes: Enter → a column in the rain, storage (`notes.txt` or the browser), English → sushi |
| `recipe.js` | The sushi recipe raining down some columns (half-width katakana and English) |
| `sound.js` | Synthesised sounds (Web Audio, no audio files) |
| `panel.js` | The Esc menu |
| `server.py` | Serves the app on 127.0.0.1:8777 and keeps `notes.txt` (Python 3 standard library only) |
| `run.cmd` | Windows launcher: starts the server and opens the page |

### Plugin API (`window.SR`)

Plugins are plain `<script>` files loaded after `core.js` and before `SR.start()`, and talk to the core
only through `window.SR`.

**Hooks** (`SR.on(name, fn)`):

| Hook | Called with | Notes |
|---|---|---|
| `frame` | `(dt, now)` | Every frame before drawing. Seconds. |
| `drawBack` | `(ctx, grid)` | After the background clear, before the rain |
| `drawOver` | `(ctx, grid)` | After rain, text and cursor |
| `key` | `(KeyboardEvent)` | Window keydown, capture phase, before the editor. Return `true` to consume it. Only consume your own keys. |
| `type` | `({index, text})` | After text was inserted (typing, paste, undo) |
| `erase` | `({index, count, text})` | After text was removed |
| `dropText` | `(col)` | A new drop starts at the top of column `col`. Return a string or `{text, speed, len, style, tag}` to make it write that text down the column. First non-null answer wins, so load order matters. |
| `settings` | `(settings, changedKey)` | After `SR.setSetting` (key is null after a reset) |
| `resize` | `(grid)` | After the grid was rebuilt |

**Settings:** `SR.settings` (live), `SR.DEFAULTS`, `SR.setSetting(key, value)`, `SR.resetSettings()`,
`SR.addSetting(key, default, control?)`. `SR.controls` is what the menu renders:
`{key, label, type: 'range'|'toggle'|'select', group, min, max, step, options, format, unit}`.
`SR.THEMES` and `SR.theme()`; the CSS variables `--sr-rain --sr-head --sr-text --sr-hl --sr-bg --sr-font`
follow the theme. `SR.GLYPH_SETS` holds what the rain can be made of.

**Drawing:** `SR.grid` `{dpr, W, H, fontPx, cw, ch, cols, rows, ox, oy}` (device pixels), `SR.cellX(col)`,
`SR.cellY(row)`, `SR.drawGlyph(char, style, col, row, alpha)`, `SR.addStyle(name, {color, glow, mirror, glowColor})`,
`SR.randGlyph()`, `SR.noiseGlyph(seed, now, rate)`. The rain: `SR.rain.spawn({col, y, speed, len, text, style, tag, stopAt})`,
`SR.rain.advance(drop, y)`, `SR.rain.cellLight(col, row)` (0 = a drop head is here, -1 = dark),
`SR.rain.cellGlyph(col, row)`, `SR.rain.screenRow(r)`. `SR.layout` is the last frame's text layout.

**Text and UI:** `SR.getText()`, `SR.setText(str)` (undoable), `SR.insertText(str)`, `SR.autoType(str, cps)`,
`SR.saveFile()`, `SR.openFile()`, `SR.toast(msg, ms)`, `SR.hints` (lines under an empty page),
`SR.panelSections.push({id, title, render(el, {close, refresh})})` (a section in the Esc menu),
`SR.modal` (set while your own panel has the keyboard), `SR.focusInput()`, `SR.store` (localStorage, safely).

**From the plugins:** `SR.notes` `{list, add, importLines, setDone, remove, clear, status, onChange, toSushi, when}`,
`SR.noteList`, `SR.importNotes`, `SR.quick`, `SR.panel` `{open, close, isOpen}`, `SR.recipe` `{cycle, cascade}`,
`SR.sound` `{play(name)}`.

## About the rain

Simon Whiteley, who designed the falling code for *The Matrix*, has said he made it from characters
scanned out of his wife's Japanese cookbooks. This project is a fan-made homage, not affiliated with
the film. All of its code, sounds and the rain itself are original.
