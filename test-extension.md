# ChatGPT Tab Monitor - Testing Instructions

## Installation
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select this directory
4. The extension should now be installed

## Testing Features

### Basic Functionality
1. **Install Extension**: Load the extension in Chrome developer mode
2. **Open ChatGPT Tabs**: Open multiple tabs with chat.openai.com or chatgpt.com
3. **Check Badge**: Extension badge should show number of ChatGPT tabs

### Status Detection
1. **Processing State**: 
   - Start typing a message in ChatGPT
   - Send the message
   - Tab title should show 🔴 prefix
   - Extension badge should turn red with count

2. **Completed State**:
   - Wait for ChatGPT response to finish
   - Tab title should show 🟢 prefix  
   - Extension badge should turn green with count

3. **Idle State**:
   - When no conversation is active
   - Tab title shows no prefix
   - Extension badge shows gray with total count

### Popup Interface
1. Click extension icon to open popup
2. Should show all ChatGPT tabs grouped by window
3. Color-coded status indicators (red/green/gray circles)
4. Click on any tab to focus it
5. Use refresh button to update status

### Multi-Window Support
1. Open ChatGPT tabs in different browser windows
2. Popup should group tabs by window
3. Status detection should work across all windows

## Expected Behavior

- **Tab Titles**: Should have colored circle prefixes (🔴🟢) based on status
- **Extension Badge**: Shows count with appropriate color
- **Popup**: Real-time status updates, organized by window
- **Performance**: Minimal impact, efficient monitoring

## Troubleshooting

If the extension doesn't work:
1. Check console for errors (F12 in popup/background page)
2. Verify permissions are granted
3. Reload ChatGPT tabs
4. Restart extension from chrome://extensions/

## Known Limitations

- Works only on chat.openai.com and chatgpt.com domains
- Status detection depends on UI elements that may change
- Requires page refresh if ChatGPT UI is significantly updated