# Journeyman Desktop — the game master's codex

> [Русская версия](README.ru.md)

The desktop edition of [Journeyman](https://github.com/KennyS44/Journeyman): a
library of material for tabletop RPG game masters. A normal program with a
shortcut and a window — no browser to open, no internet needed, and your data
sits in a folder on disk and never goes anywhere.

![The application window](docs/screenshot.png)

*Screenshot taken automatically by a test run in a real Electron window.*

## What already works

Everything the web version does has been carried over: spaces, the canvas with
cards and links, the text editor with tables and images, the gallery, music with
a mini player, markers, dice, the roll calculator, and plan notes.

What is new in the desktop edition:

- **Your data is just files.** `db.json` holds the records and the `assets`
  folder holds images, music and video. Copy the folder onto a USB stick and
  that is your backup. "File → Show data folder" opens it.
- **Works offline.** Fonts are bundled with the program; nothing is loaded from
  the network.
- **Volume is remembered** — one level for the whole program, surviving moves
  between objects and restarts.
- **The window remembers its size and position** between launches, and a second
  copy of the program refuses to start, so two of them never write to the same
  files.
- **Menus with keyboard shortcuts** for text editing, zoom and full-screen mode,
  as well as for saving and loading the codex (Ctrl+S and Ctrl+O).

## Installation

Prebuilt binaries live on the [Releases](../../releases/latest) page. On Windows
10/11 (64-bit) a single file is all you need — take your pick:

- [Journeyman-Setup-0.1.0.exe](../../releases/download/v0.1.0/Journeyman-Setup-0.1.0.exe)
  — an installer that adds shortcuts to the Start menu and the desktop;
- [Journeyman-Portable-0.1.0.exe](../../releases/download/v0.1.0/Journeyman-Portable-0.1.0.exe)
  — no installation, runs straight from the file.

The installer is unsigned, so on first launch Windows will show the "Windows
protected your PC" dialog: **"More info"** → **"Run anyway"**.

Your data ends up in `%APPDATA%\Journeyman\data` — that whole folder can be
copied as a backup.

Linux builds (`.AppImage`) and intermediate versions are available as
[Actions](../../actions) artifacts.

## Development

    npm install
    npm start              # run the program
    npm test               # parser, packer, storage (48 + 16 + 18 checks)
    npm run test:renderer   # screens on top of real storage + codex transfer
    npm run test:ui         # a real Electron window (needs a desktop or xvfb)
    npm run dist:win        # build the Windows installer
    npm run dist:linux      # build the AppImage

## How it is put together

    src/main/main.js       main process: window, menus, bridge to storage
    src/main/storage.js    records in db.json, files in assets/ — no browser, no database
    src/preload.js         the single door between the screens and the disk
    src/renderer/          the interface: the same one as in the web version
      js/db.js             adapter: the web version's DB interface on top of files
      js/ui.js, calc.js    helpers and the expression parser — carried over verbatim
      js/zip.js            reading and writing zip — carried over verbatim
      js/backup.js         codex to a file and back — carried over verbatim
      js/app.js, screens/  the shell and the three screens — carried over verbatim
      css/, fonts/         styling and the bundled fonts
    tests/                 tests for the parser and storage, plus two interface runs

The key decision behind the port: the screens were not touched at all. The web
version's storage layer (`DB` on top of IndexedDB) was replaced by an adapter
with the same method names and the same response shape, while the data itself is
written by the main process. The details and the list of differences are in
[docs/PORTING.md](docs/PORTING.md).

## Moving material over from the browser version

Both versions read and write the same format — a `.jm.zip` file. Here is how:

1. In the [web version](https://github.com/KennyS44/Journeyman), click "Save to
   file" at the bottom of the menu.
2. Here, choose "File → Load codex from file…" (or the same button at the bottom
   of the menu) and pick the file you got.

What you load is added alongside what is already there, overwriting nothing. It
works the same way in the other direction: a file saved here opens in the
browser version.

Inside it is a plain zip: `codex.json` with the records and an `assets` folder
with images, video and music exactly as they are. You can open it with any
archiver and get your material out even if neither the program nor the website
is at hand.

An individual space is saved with the button in its header — handy for sharing a
single campaign rather than the whole codex.

## Licences

The code is MIT (see `LICENSE`). The Cinzel and Spectral fonts are under the SIL
Open Font License 1.1; the licence texts sit next to the fonts in
`src/renderer/fonts`.
