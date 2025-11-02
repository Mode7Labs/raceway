# Raceway Documentation

This directory contains the VitePress-powered documentation for Raceway.

## Development

```bash
# Start dev server (hot reload)
npm run docs:dev

# Build for production
npm run docs:build

# Preview production build
npm run docs:preview
```

The docs will be available at `http://localhost:5173`

## Structure

```
docs/
├── .vitepress/
│   └── config.mjs          # VitePress configuration
├── index.md                # Landing page
├── changelog.md            # Release notes
├── guide/                  # User guides
│   ├── getting-started.md
│   ├── core-concepts.md
│   └── ...
├── sdks/                   # SDK documentation
│   ├── overview.md
│   ├── typescript.md
│   └── ...
└── api/                    # API reference
    ├── overview.md
    └── ...
```

## Writing Docs

All documentation is written in Markdown. VitePress extends standard Markdown with:

### Code Blocks with Tabs

```markdown
::: code-group

\`\`\`typescript [TypeScript]
const client = new RacewayClient();
\`\`\`

\`\`\`python [Python]
client = RacewayClient()
\`\`\`

:::
```

### Custom Containers

```markdown
::: tip
This is a tip
:::

::: warning
This is a warning
:::

::: danger
This is a danger notice
:::
```

### Internal Links

```markdown
See [Getting Started](/guide/getting-started) for more info.
```

## Deployment

Documentation is automatically deployed to GitHub Pages when changes are pushed to the `main` branch.

- **Live Site**: https://mode7labs.github.io/raceway/
- **GitHub Actions**: Builds and deploys on every push to `docs/`

### Manual Deployment

If needed, you can manually trigger deployment:

1. Go to GitHub Actions
2. Select "Deploy Documentation" workflow
3. Click "Run workflow"

## Adding New Pages

1. Create a new `.md` file in the appropriate directory
2. Add it to the sidebar in `.vitepress/config.mjs`:

```js
sidebar: {
  '/guide/': [
    {
      text: 'Getting Started',
      items: [
        { text: 'Your New Page', link: '/guide/your-new-page' }
      ]
    }
  ]
}
```

## Troubleshooting

### Dev server won't start

Make sure VitePress is installed:

```bash
npm install
```

### Images not showing

Place images in `docs/` (e.g., `docs/logo.png`) and reference with absolute paths:

```markdown
![Logo](/logo.png)
```

### Links broken after build

Use absolute paths starting with `/`:
- ✅ `/guide/getting-started`
- ❌ `guide/getting-started`
- ❌ `./getting-started`
