# Obsidian Source Note Creator

A Firefox extension + local Python server that saves any webpage as a source note in your Obsidian vault with one click.

## What it does

1. Click the extension icon on any webpage
2. The extension sends the URL to a local Python server
3. The server fetches the page content (with special handling for YouTube and Reddit)
4. Uses Gemini API to match/create relevant topics and draft note content
5. Creates a properly formatted source note in your vault under `002 - Source Material/`

## Setup

### 1. Python server

```bash
# Install dependencies
pip install -r requirements.txt

# Set your Gemini API key
export GEMINI_API_KEY=your-key-here

# Optional: set your vault path (defaults to ~/Obsidian/Ashley in Wonderland)
export OBSIDIAN_VAULT_PATH="/path/to/your/vault"

# Start the server
python server.py
```

The server runs on `http://127.0.0.1:52525` by default. Change with `SOURCE_NOTE_PORT` env variable.

### 2. Firefox extension

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on..."**
3. Navigate to the `extension/` folder and select `manifest.json`

The extension icon will appear in your toolbar. To make it permanent, you'd need to sign it via [addons.mozilla.org](https://addons.mozilla.org).

## Usage

1. Make sure `server.py` is running
2. Navigate to any webpage you want to save
3. Click the extension icon
4. Optionally override the auto-detected media type
5. Click **"Save to Obsidian"**

The note will appear in your vault under the appropriate subfolder of `002 - Source Material/`.
