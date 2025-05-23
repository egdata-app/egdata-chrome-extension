import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { TanStackRouterRspack } from '@tanstack/router-plugin/rspack';

// const isProd = process.env.NODE_ENV === 'production';
const port = 3000;

export default defineConfig({
  dev: {
    client: {
      port,
      host: '127.0.0.1',
      protocol: 'ws',
    },
    writeToDisk: true,
  },
  server: {
    port,
    strictPort: true,
    publicDir: {
      copyOnBuild: false,
    },
  },
  output: {
    filenameHash: false,
  },
  environments: {
    web: {
      plugins: [pluginReact()],
      source: {
        entry: {
          main: './src/main/index.tsx',
        },
      },
      html: {
        title: '',
      },
      output: {
        target: 'web',
        copy: [{ from: './public' }],
      },
    },
    webworker: {
      plugins: [pluginReact()],
      source: {
        entry: {
          background: './src/background/index.ts',
          contentScript: './src/content-script/index.tsx',
        },
      },
      output: {
        target: 'web-worker',
      },
    },
  },
  tools: {
    rspack: {
      devtool: 'source-map',
      plugins: [
        TanStackRouterRspack({
          target: 'react',
          autoCodeSplitting: true,
          routesDirectory: './src/main/routes',
          generatedRouteTree: './src/main/routeTree.gen.ts',
          routeFileIgnorePrefix: '-',
          quoteStyle: 'single',
        }),
      ],
    },
  },
});
