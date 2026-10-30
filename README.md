# 🎵 Musify Music Player

**Your music. Your library.** An offline music player that runs in your browser and plays songs straight from a folder on your computer. No installation, no account, no server, and nothing is ever uploaded.

Built with plain **HTML, CSS and vanilla JavaScript** as a BSc (Information Technology) project.

> **Live demo:** `https://<your-github-username>.github.io/<repository-name>/`
> *(replace with your GitHub Pages link after you publish)*

<!-- Add a screenshot: save it as screenshots/home.png and uncomment the next line -->
<!-- ![Musify Home page](screenshots/home.png) -->

---

## ✨ Features

**Library**
- Pick your music folder once and Musify builds the library automatically
- Remembers the folder, so a page refresh reconnects without asking again (when the browser allows it)
- Skips broken song folders and shows a placeholder when a cover image is missing
- Manual **Refresh Library** button and optional 30-second auto-refresh

**Playback**
- Play, pause, next, previous, seek bar, duration, volume and mute
- Songs are loaded only when played, so large libraries stay fast

**Home and search**
- Permanent search bar on the Home page
- Real-time, case-insensitive search across **title, artist, album and genre**
- Results float over a blurred, dimmed Home page, with a result count, a clear button and a "No results found" state
- Close search with `Esc`, the clear button, or by clicking outside

**Discover**
- Recently Added, Recently Played and Similar Songs on Home
- Library, Favorites and Artists pages
- ❤️ Favorites everywhere, saved on your device
- Three-dot menu on Recently Played: remove a song from history, or add or remove it from Favorites

**Interface**
- Burgundy, charcoal and gold theme with smooth, short animations
- Responsive layout for desktop, tablet and small screens
- Keyboard accessible, with visible focus states and ARIA labels
- Respects the system **reduce motion** setting

---

## 🚀 How to use

1. Open the live demo (or run it locally, see below) in **Google Chrome or Microsoft Edge on desktop**.
2. Click **Choose Music Folder** and select your main music folder.
3. Click a song to play it, and use the search bar on Home to find anything quickly.

If your browser asks for permission again after a refresh, click **Reconnect Music Folder**.

### Prepare your music folder

Each song lives in its own folder with three files:

```text
music/
├── song1/
│   ├── song.mp3        ← the audio (required)
│   ├── info.json       ← the song details (required)
│   └── cover.jpg       ← the artwork (optional)
├── song2/
│   ├── song.mp3
│   ├── info.json
│   └── cover.jpg
└── ...
```

Example `info.json` (only `title` is required):

```json
{
  "title": "Song Title",
  "artist": "Artist Name",
  "album": "Album Name",
  "genre": "Pop",
  "year": 2024
}
```

---

## 💻 Run locally

The File System Access API needs a secure context, so use a local server (or GitHub Pages) rather than double-clicking `index.html`.

```bash
# clone the project
git clone https://github.com/<your-github-username>/<repository-name>.git
cd <repository-name>

# start any simple local server, for example:
python -m http.server 8000
```

Then open `http://localhost:8000` in Chrome or Edge. You can also use the **Live Server** extension in Visual Studio Code.

## 🌐 Publish on GitHub Pages

1. Push the project to a GitHub repository.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and the `/ (root)` folder, then save.
4. After a minute your site is live at `https://<your-github-username>.github.io/<repository-name>/`.

---

## 🧰 Tech stack

| Area | Technology |
|---|---|
| Structure and styling | HTML5, CSS3 (Grid, Flexbox, transitions, `backdrop-filter`) |
| Logic | Vanilla JavaScript (ES6+, async/await) |
| Folder access | File System Access API |
| Remembered folder | IndexedDB |
| Favorites and history | localStorage |
| Audio | HTML5 `<audio>` with Blob URLs |
| Tools | Visual Studio Code, Git, GitHub Pages |

No frameworks, no libraries, no backend.

## 📁 Project structure

```text
├── index.html   # page structure
├── style.css    # theme, layout, animations, responsive rules
├── script.js    # folder access, scanning, playback, search, favorites
└── README.md
```

## 🔄 How it works

- **Remembering the folder:** the chosen folder handle is saved in IndexedDB. On the next visit Musify checks its permission without showing a prompt. If access is already granted, it scans the library automatically. If the browser needs a click, a **Reconnect Music Folder** button appears. If the folder is gone, you can choose a new one.
- **Fast search:** every song stores one lowercase search string, and only the results panel is redrawn while you type, so the search box never loses focus.
- **Light on memory:** only the song being played is read from your folder.
- **Smarter auto-refresh:** it lists folder names only and rescans fully when song folders are added or removed.
- **Similar Songs:** other songs are scored by artist (3 points), genre (2) and album (1), and the top five are shown.

## 🆕 What's new in V2

- Home page search overlay with a blurred background (the Search tab was removed)
- Automatic reconnection to the remembered music folder
- Premium transitions and animations throughout
- Recently Played three-dot menu with remove and favorite actions
- Desktop and mobile polish, accessibility and reduced-motion support
- Lighter auto-refresh and cached song durations

## ⚠️ Limitations

- Choosing a folder works in **Chrome and Edge on desktop**. Firefox, Safari and most mobile browsers do not support the folder picker.
- Browsers can ask for folder permission again from time to time, so permission is not guaranteed to last forever.
- Only MP3 audio and JPG covers are supported, and each song needs its own folder.
- Auto-refresh notices added or removed song folders, but not edits inside an existing one. Use **Refresh Library** for those.

## 🔮 Future scope

- Playlists, play queue, shuffle and repeat
- Equalizer using the Web Audio API
- Reading tags directly from MP3 files so `info.json` is optional
- More audio and image formats
- Installable web app (PWA) and lyrics

---

## 👤 Author

**Mohammed Yaseen Siddiqi**
BSc (Information Technology) · Ramanand Arya D.A.V College (Autonomous), Mumbai
📧 ysiddiqi71@gmail.com

Project guide: Ms. Steffey Weseley

## 📄 License

This project was created for academic purposes. Add a license of your choice (for example MIT) before sharing it publicly.
