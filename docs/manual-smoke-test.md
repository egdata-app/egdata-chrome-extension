# Manual Extension Smoke Test

1. Run `pnpm build`.
2. Load `dist` as an unpacked extension in Chrome.
3. Click the extension action and confirm the dashboard opens.
4. If disconnected, click `Connect Epic Games`, sign in, then return to the extension dashboard.
5. Click `Sync Library` and confirm the library item count updates without an error.
6. Open the `Library` page, search for a known owned title, and confirm pagination still works.
7. Visit `https://store.epicgames.com/`, browse product cards, and confirm owned badges render only when the dashboard setting is enabled.
8. From an egdata.app page, call the external ownership message API and confirm it returns owned slugs/offers without exposing an Epic token.
