# Documentation Site Setup

VitePress documentation site has been successfully set up for Raceway!

## What Was Created

### VitePress Configuration
- **`.vitepress/config.mjs`**: Main configuration with navigation, sidebar, and search
- **Build scripts** in `package.json`:
  - `npm run docs:dev` - Start development server
  - `npm run docs:build` - Build for production
  - `npm run docs:preview` - Preview production build

### Documentation Structure

```
docs/
├── .vitepress/
│   ├── config.mjs          # Site configuration
│   └── dist/               # Build output (generated)
├── index.md                # Landing page with hero section
├── changelog.md            # Release notes
├── logo.png                # Raceway logo
├── README.md               # Docs development guide
├── guide/                  # User guides
│   ├── what-is-raceway.md
│   ├── getting-started.md
│   ├── core-concepts.md
│   ├── architecture.md
│   ├── race-detection.md
│   ├── critical-path.md
│   ├── anomalies.md
│   ├── audit-trails.md
│   ├── distributed-tracing.md
│   ├── web-ui.md
│   ├── tui.md
│   ├── http-api.md
│   ├── configuration.md
│   ├── storage.md
│   └── security.md
├── sdks/                   # SDK documentation
│   ├── overview.md
│   ├── typescript.md
│   ├── python.md
│   ├── go.md
│   └── rust.md
└── api/                    # API reference
    ├── overview.md
    ├── events.md
    ├── traces.md
    ├── analysis.md
    └── services.md
```

### GitHub Actions Workflow
- **`.github/workflows/deploy-docs.yml`**: Automatic deployment to GitHub Pages
- Triggers on pushes to `main` branch that affect `docs/` folder
- Can also be triggered manually from GitHub Actions tab

## Local Development

### Start Dev Server
```bash
npm run docs:dev
```

Visit `http://localhost:5173` to see your docs with hot reload.

### Build for Production
```bash
npm run docs:build
```

Output will be in `docs/.vitepress/dist/`

### Preview Production Build
```bash
npm run docs:preview
```

## Deployment to GitHub Pages

### Automatic Deployment

1. Push changes to `main` branch
2. GitHub Actions will automatically build and deploy
3. Site will be live at `https://mode7labs.github.io/raceway/`

### Manual Deployment

1. Go to GitHub repository
2. Click "Actions" tab
3. Select "Deploy Documentation" workflow
4. Click "Run workflow"

### Enable GitHub Pages (One-Time Setup)

1. Go to repository Settings
2. Navigate to "Pages" in sidebar
3. Under "Build and deployment":
   - Source: "GitHub Actions"
4. Save

## Features

### Navigation
- **Top nav**: Home, Guide, SDKs, API, Version dropdown
- **Sidebar**: Context-aware navigation for each section
- **Search**: Built-in full-text search across all pages

### Content Features
- **Code tabs**: Multi-language code examples
- **Syntax highlighting**: Automatic for all languages
- **Dark/light theme**: User preference toggle
- **Mobile responsive**: Works on all devices
- **Fast**: Pre-rendered static HTML with SPA navigation

### Landing Page
- Hero section with logo and call-to-action
- Feature grid highlighting key capabilities
- Quick start guide
- Multi-language code examples

## Adding New Pages

1. Create a new `.md` file in the appropriate directory
2. Write content in Markdown
3. Add to sidebar in `.vitepress/config.mjs`:

```js
sidebar: {
  '/guide/': [
    {
      text: 'Your Section',
      items: [
        { text: 'New Page', link: '/guide/new-page' }
      ]
    }
  ]
}
```

## Documentation Status

### Completed Pages
- ✅ Landing page (`index.md`)
- ✅ Changelog (`changelog.md`)

### Guide Pages
- ✅ What is Raceway (`guide/what-is-raceway.md`)
- ✅ Getting Started (`guide/getting-started.md`) - Updated with middleware workflow
- ✅ Core Concepts (`guide/core-concepts.md`)
- ✅ Architecture (`guide/architecture.md`)
- ✅ Race Detection (`guide/race-detection.md`)
- ✅ Critical Path Analysis (`guide/critical-path.md`)
- ✅ Anomalies (`guide/anomalies.md`)
- ✅ Audit Trails (`guide/audit-trails.md`)
- ✅ Distributed Tracing (`guide/distributed-tracing.md`)
- ✅ Web UI (`guide/web-ui.md`) - Updated with correct setup
- ✅ TUI (`guide/tui.md`)
- ✅ HTTP API (`guide/http-api.md`)
- ✅ Configuration (`guide/configuration.md`) - Rewritten to match implementation
- ✅ Storage (`guide/storage.md`)
- ✅ Security (`guide/security.md`) - Includes reverse proxy examples

### SDK Documentation
- ✅ Overview (`sdks/overview.md`)
- ✅ TypeScript (`sdks/typescript.md`) - Includes authentication
- ✅ Python (`sdks/python.md`) - Includes authentication
- ✅ Go (`sdks/go.md`) - Includes authentication
- ✅ Rust (`sdks/rust.md`) - Includes authentication

### API Reference
- ✅ Overview (`api/overview.md`) - Updated routes with `/api/` prefix
- ✅ Events (`api/events.md`)
- ✅ Traces (`api/traces.md`) - Synchronized with server
- ✅ Analysis (`api/analysis.md`) - Synchronized with server
- ✅ Services (`api/services.md`) - Synchronized with server

## Future Enhancements

1. Add screenshots/diagrams to guides
2. Create tutorial series
3. Add interactive examples
4. Add video tutorials
5. Add search analytics
6. Add API playground

## Troubleshooting

### Build fails with dead links
- Check all internal links use absolute paths: `/guide/page` not `./page`
- External localhost URLs are ignored in config

### Images not showing
- Place images in `docs/` directory
- Reference with absolute paths: `![Logo](/logo.png)`

### Dev server shows 404
- Ensure you're using correct ports (5173 for docs, 8080 for server)
- Check VitePress is installed: `npm install`

## Resources

- [VitePress Documentation](https://vitepress.dev/)
- [Markdown Extensions](https://vitepress.dev/guide/markdown)
- [Theme Configuration](https://vitepress.dev/reference/default-theme-config)
