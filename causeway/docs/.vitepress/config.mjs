import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Raceway',
  description: 'Deep concurrency analysis and debugging for distributed systems',

  base: '/raceway/',

  head: [
    ['link', { rel: 'icon', href: '/raceway/logo.png' }]
  ],

  ignoreDeadLinks: [
    // Allow localhost URLs in code examples
    /^http:\/\/localhost/,
  ],

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'SDKs', link: '/sdks/overview' },
      { text: 'API', link: '/api/overview' },
      {
        text: 'v0.1.0',
        items: [
          { text: 'Changelog', link: '/changelog' },
          { text: 'GitHub', link: 'https://github.com/mode7labs/raceway' }
        ]
      }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          collapsed: false,
          items: [
            { text: 'What is Raceway?', link: '/guide/what-is-raceway' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Core Concepts', link: '/guide/core-concepts' },
            { text: 'Architecture', link: '/guide/architecture' }
          ]
        },
        {
          text: 'Features',
          collapsed: false,
          items: [
            { text: 'Race Detection', link: '/guide/race-detection' },
            { text: 'Critical Path Analysis', link: '/guide/critical-path' },
            { text: 'Anomaly Detection', link: '/guide/anomalies' },
            { text: 'Variable Audit Trails', link: '/guide/audit-trails' },
            { text: 'Distributed Tracing', link: '/guide/distributed-tracing' }
          ]
        },
        {
          text: 'User Interfaces',
          collapsed: false,
          items: [
            { text: 'Web UI', link: '/guide/web-ui' },
            { text: 'Terminal UI (TUI)', link: '/guide/tui' },
            { text: 'HTTP API', link: '/guide/http-api' }
          ]
        },
        {
          text: 'Advanced',
          collapsed: false,
          items: [
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Storage Options', link: '/guide/storage' },
            { text: 'Security', link: '/guide/security' }
          ]
        }
      ],
      '/sdks/': [
        {
          text: 'SDKs',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/sdks/overview' },
            { text: 'TypeScript/Node.js', link: '/sdks/typescript' },
            { text: 'Python', link: '/sdks/python' },
            { text: 'Go', link: '/sdks/go' },
            { text: 'Rust', link: '/sdks/rust' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API Reference',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/api/overview' },
            { text: 'Events', link: '/api/events' },
            { text: 'Traces', link: '/api/traces' },
            { text: 'Analysis', link: '/api/analysis' },
            { text: 'Services', link: '/api/services' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/mode7labs/raceway' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present Mode 7 Labs'
    },

    search: {
      provider: 'local'
    }
  }
})
