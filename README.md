# ChatGPT Wrangler

A Chrome extension that monitors ChatGPT tabs and provides visual indicators for processing status.

## Features

- **Real-time Status Monitoring**: Tracks when ChatGPT is processing requests vs idle
- **Visual Indicators**: Tab titles display colored circles (🔴 for processing, 🟢 for idle)
- **Badge Counter**: Extension badge shows count of ChatGPT tabs with status-based coloring
- **Multi-Window Support**: Organizes tabs by browser window in the popup
- **Clean Interface**: Modern popup UI with tab management and debug tools

## Installation

### Download the Code

First, get the extension code on your computer:

**Option 1: Download ZIP**
1. Click the green "Code" button on this GitHub page
2. Select "Download ZIP"
3. Extract the ZIP file to a folder on your computer

**Option 2: Clone with Git**
```bash
git clone https://github.com/yourusername/chatgpt-wrangler.git
cd chatgpt-wrangler
```

### Install in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked" and select the project directory (the folder containing `manifest.json`)
4. The ChatGPT Wrangler extension should now be installed and active

## How It Works

The extension uses three main components:

- **Content Script** (`content.js`): Monitors DOM changes on ChatGPT pages to detect processing state
- **Background Script** (`background.js`): Manages tab state, badge updates, and inter-component communication
- **Popup Interface** (`popup.html`/`popup.js`): Provides a dashboard view of all ChatGPT tabs

### Status Detection

The extension detects ChatGPT's processing state by monitoring:
- DOM mutations for response generation indicators
- UI element changes that signal processing vs idle states
- Page title updates and interface state changes

## Usage

1. **Open ChatGPT tabs** on chat.openai.com or chatgpt.com
2. **Monitor status**: Tab titles will show colored indicators
   - 🔴 Red circle: ChatGPT is processing a request
   - 🟢 Green circle: ChatGPT is idle/ready
3. **Use the popup**: Click the extension icon to see all ChatGPT tabs organized by window
4. **Navigate quickly**: Click any tab in the popup to focus it

## Development

Built with vanilla JavaScript for the Chrome Extension Manifest V3. The project includes:

- TypeScript configuration for development
- Bun as the preferred runtime and package manager
- Modular architecture with clear separation of concerns

### Project Structure

```
chatgpt-wrangler/
├── manifest.json          # Extension configuration
├── background.js          # Service worker for tab management
├── content.js            # DOM monitoring on ChatGPT pages
├── popup.html            # Extension popup interface
├── popup.js              # Popup functionality and UI
├── index.ts              # Development entry point
└── package.json          # Project dependencies
```

## Permissions

The extension requires:
- `tabs`: To monitor and manage ChatGPT tabs
- `activeTab`: To interact with the current tab
- `storage`: To persist settings and state
- `scripting`: To inject content scripts
- Host permissions for `chat.openai.com` and `chatgpt.com`

## Compatibility

- Chrome browsers with Manifest V3 support
- Works on chat.openai.com and chatgpt.com domains
- Tested across multiple browser windows and tab configurations

## Known Limitations

- Status detection depends on ChatGPT's UI structure which may change
- Only monitors official ChatGPT domains
- Requires DOM elements to be present for accurate status detection
