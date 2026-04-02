# Obsidian Source Note Creator

A Firefox extension that saves any webpage as a source note in your Obsidian vault with one click. Uses the Gemini API directly from the browser — no server or deployment needed.

## What it does

1. Click the extension icon on any webpage
2. The extension extracts the page content directly from the DOM
3. Calls the Gemini API to match relevant topics and generate a context summary
4. Creates a formatted source note in your vault under `002 - Source Material/`

## Setup

### 1. Install the extension

**Option A: Temporary (for testing)**
1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on..."**
3. Navigate to the `extension/` folder and select `manifest.json`

**Option B: Permanent (via registry)**
1. Run `install.bat` as Administrator
2. Restart Firefox

### 2. Configure the extension

1. Right-click the extension icon > **Manage Extension** > **Preferences**
2. Enter your **Gemini API Key** (free from [aistudio.google.com/apikey](https://aistudio.google.com/apikey))
3. Enter your **Vault Name** exactly as it appears in Obsidian
4. Click **Scan Topics Folder** and select your `003 - Topics/` folder to load existing topics
5. Click **Save**

## Usage

1. Navigate to any webpage you want to save
2. Click the extension icon (or right-click > **Save as Source Note**)
3. Optionally override the auto-detected media type
4. Click **"Save to Obsidian"**

The note will appear in your vault under the appropriate subfolder of `002 - Source Material/`.

## Packing the extension

Run `pack-extension.bat` to create `obsidian-source-note.xpi` for distribution.
