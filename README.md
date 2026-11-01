# Tabie

> Browse anything. Find, switch and tidy your tabs with search, previews and keyboard shortcuts.

Tabie is a powerful browser extension that helps you manage your tabs efficiently. Whether you have 10 tabs or 1000+, Tabie makes it easy to find, organize, and clean up your browsing session.

## Features

- **Universal Search**: Find open tabs, closed tabs, downloads, or search the web from one search bar
- **Tab Previews**: Visual thumbnails of your tabs for quick identification
- **History & Recently Closed**: Quick access to your browsing history and tabs you've recently closed
- **Downloads Manager**: Track and manage all your downloads in one place
- **Shortcuts**: Star your favorite tabs for quick access
- **Bulk Actions**: Select multiple tabs to close them or move them to a new window
- **Smart Sleep**: Unload tabs you haven't used in 30 minutes to free memory (they reload when you open them)
- **Magic Tabs**: Automatically reorder tabs in each window by website
- **Merge Windows**: Consolidate all tabs from all windows into a single window
- **Super Clean**: Quickly clean up old tabs, duplicates, or all tabs with age-based filters
- **Keyboard Shortcuts**: Full keyboard navigation for power users
- **Side Panel**: Use Tabie in a side panel alongside your content (Chrome/Edge)
- **New Tab Page**: Replaces your browser's new tab page for instant access
- **Themes**: Auto, light, and dark mode to match your preference

## Installation

### Chrome / Edge / Brave / other Chromium browsers

1. Download the extension files
2. Open your browser and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the Tabie directory
5. Pin the extension to your toolbar for easy access

### Firefox

1. Download the extension files
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select the `manifest.json` file in the Tabie directory

Note: For Firefox, the extension will need to be reloaded each time you restart the browser. For permanent installation, you'll need to package it and sign it through the Firefox Add-ons Developer Hub.

## Usage

### Opening Tabie

- **Click the toolbar icon** (the Tabie logo with four squares)
- **Press `Alt+T`** (or `⌥T` on Mac) from any site
- **Open a new tab** — Tabie replaces the new tab page
- **Press `Alt+Shift+P`** (or `⌥⇧P` on Mac) to open in the side panel (Chrome/Edge)

### Searching

1. Click the search bar or start typing
2. Tabie searches through:
   - Open tabs (by title and URL)
   - Browser history
   - Downloads
   - Bookmarked shortcuts
3. Press `Enter` to open the selected tab, or search Google if nothing matches

### Managing Tabs

- **Navigate** with arrow keys (`↑` `↓` `←` `→`)
- **Close tabs** with `Shift+Backspace`
- **Star/unstar tabs** with `Alt+S` (or `⌥S` on Mac)
- **Select multiple tabs** with `Shift+Enter`, then use bulk actions

### Side Panels

- **History & Recently Closed**: Press `Alt+H` (or `⌥H` on Mac)
- **Downloads**: Press `Alt+D` (or `⌥D` on Mac)
- **Shortcuts**: Click the star icon in the toolbar

### Cleaning Up

Use the status bar actions:

- **Super Clean**: Clean tabs by age (1h, 2h, 4h, 6h), remove duplicates, or clean all
- **Smart Sleep**: Unload tabs unused for 30+ minutes
- **Magic Tabs**: Reorder tabs by website
- **Merge Windows**: Move all tabs into the current window

## Keyboard Shortcuts

### In Tabie

| Shortcut | Action |
|----------|--------|
| `↑` `↓` `←` `→` | Move between tabs |
| `Enter` | Open tab · search Google if nothing matches |
| `Esc` | Close sheet · clear search · go back |
| `Shift+Backspace` | Close tab |
| `Alt+S` / `⌥S` | Star / unstar tab |
| `Shift+Enter` | Select for bulk actions |
| `Alt+H` / `⌥H` | History and recently closed |
| `Alt+D` / `⌥D` | Downloads |
| `Cmd+K` / `Ctrl+K` | Show keyboard shortcuts |

### Anywhere in the Browser

| Shortcut | Action |
|----------|--------|
| `Alt+T` / `⌥T` | Go to Tabie from any site |
| `Alt+Shift+←` / `⌥⇧←` | Jump to the previously used tab |
| `Alt+Shift+P` / `⌥⇧P` | Open Tabie in side panel (Chrome/Edge) |

## Permissions

Tabie requires the following permissions to function:

- **tabs**: Access and manage browser tabs
- **storage**: Save preferences, tab previews, and shortcuts
- **unlimitedStorage**: Store tab previews (thumbnails)
- **sessions**: Access recently closed tabs
- **sidePanel**: Open in the browser's side panel (Chrome/Edge)
- **downloads**: Access and manage downloads
- **downloads.open**: Open downloaded files
- **bookmarks**: Save and access shortcuts
- **favicon**: Display website icons
- **history**: Access browsing history
- **<all_urls>**: Capture tab previews and access all websites

## Development

Tabie is built with vanilla JavaScript and CSS. No build process is required — just load the unpacked extension in your browser.

### Files

- `manifest.json` — Extension configuration
- `background.js` — Service worker (background script)
- `popup.html` — Main UI
- `popup.css` — Main styles
- `popup.js` — Main logic
- `onboarding.js` — Guided tour (optional, can be removed)
- `onboarding.css` — Tour styles (optional, can be removed)
- `boot.js` — Initialization
- `icons/` — Extension icons

### Browser Compatibility

- Chrome/Edge/Brave: Full support including side panel
- Firefox: Full support (except side panel)
- Safari: Not currently supported

## License

This version of Tabie is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.
I was not able to find the owner/license for the original tabie

## Privacy

Tabie runs entirely locally in your browser. No data is sent to external servers. Tab previews and preferences are stored in your browser's local storage.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
