# Manga Image Translator Extension

This Chrome extension translates manga/manhwa images on a page by sending each image to a self-hosted `manga-image-translator` backend. It uses a strict FIFO queue with max concurrency 1 and never calls ChatMock directly.

## Load the Extension in Chrome

1. Start the backend server (see main repo instructions).
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `extension/` folder.
5. Open the extension **Options** page and confirm the backend base URL (default: `http://188.166.251.233:5003`).

## Usage

- **Translate Visible Images**: queues only currently visible images on the page.
- **Auto-Translate On Scroll**: when enabled, images entering the viewport are queued in order.
- **Stop / Pause**: pauses the queue (concurrency remains 1).
- **Toggle Original/Translated**: swaps between original and translated images that have been processed.
- **Context menu**: right-click any image and choose **Translate this image**.
- **Hotkey**: `Alt+T` toggles original/translated for processed images.

## Backend Endpoint

The extension sends each image as `multipart/form-data` to:

```
POST {backendBaseUrl}/translate/with-form/image
```

Form fields:
- `image`: the image file (bytes)
- `config`: JSON string with translator settings (defaults to `chatmock`, model `gpt-5.2`)

Example config payload:

```json
{
  "translator": {
    "translator": "chatmock",
    "target_lang": "ENG",
    "chatmock_model": "gpt-5.2"
  }
}
```

## Assets

- Icons are SVG-only to avoid binary asset limitations.
- `assets/spinner.svg` is used for per-image loading indicators.
