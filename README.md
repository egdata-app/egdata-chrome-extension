# egdata.app Chrome Extension

A Chrome extension that provides enhanced functionality for Epic Games Store users, allowing them to access and manage their game library data.

## Features

- Access to Epic Games library data
- Integration with Epic Games Store authentication
- Modern UI built with React and Tailwind CSS
- Real-time data synchronization

## Prerequisites

- Node.js (Latest LTS version recommended)
- pnpm (Package manager)
- Google Chrome browser

## Installation

1. Clone the repository:
```bash
git clone https://github.com/nachoaldamav/egdata-chrome-extension
cd egdata-chrome-extension
```

2. Install dependencies:
```bash
pnpm install
```

3. Build the extension:
```bash
pnpm build
```

4. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" and select the `dist` directory from the project

## Development

To start the development server:

```bash
pnpm dev
```

## Project Structure

- `src/` - Source code
  - `background/` - Background service worker
  - `lib/` - Utility functions and shared code
  - `components/` - React components
- `public/` - Static assets and manifest
- `dist/` - Built extension files

## Technologies Used

- React 19
- TypeScript
- Tailwind CSS
- TanStack Router
- TanStack React Query
- Apollo Client
- Radix UI Components
- Biome (for linting and formatting)

## Permissions

The extension requires the following permissions:
- `cookies` - For Epic Games authentication
- `storage` - For local data persistence
- `alarms` - For background tasks

## Host Permissions

The extension can access:
- `https://store.epicgames.com/*`
- `https://*.epicgames.com/*`
- `https://*.egdata.app/*`
- `http://localhost/*`

## Building

The project uses Rsbuild for building the extension. To create a production build:

```bash
pnpm build
```

The built files will be available in the `dist` directory.

## License

ISC