# Publishing Checklist for TypeScript SDK

## Pre-Publish Verification ✅

### Main SDK (@mode-7/raceway-node)

- [x] Builds successfully (`npm run build`)
- [x] All source files compiled to dist/
- [x] Runtime module included (dist/runtime.js, dist/runtime.d.ts)
- [x] Package.json exports configured for runtime
- [x] Documentation files included (README.md, INSTRUMENTATION-GUIDE.md)
- [x] `files` array properly configured in package.json
- [x] `prepublishOnly` script set to run build
- [x] Repository field set
- [x] License set (MIT)
- [x] Keywords appropriate

**Package contents (17 files, 77.4 kB unpacked):**
- ✅ INSTRUMENTATION-GUIDE.md
- ✅ README.md
- ✅ All dist/** files (including runtime)
- ✅ package.json

### Babel Plugin (babel-plugin-raceway)

- [x] Builds successfully (`npm run build`)
- [x] All tests pass (18/18 passing)
- [x] Source files compiled to dist/
- [x] README.md updated with examples
- [x] `files` array properly configured
- [x] `prepublishOnly` script runs build and tests
- [x] Repository field set
- [x] License set (MIT)
- [x] Keywords appropriate
- [x] Peer dependencies set (@babel/core)

**Package contents (4 files, 18.6 kB unpacked):**
- ✅ README.md
- ✅ dist/index.js
- ✅ dist/index.d.ts
- ✅ package.json

## Publishing Commands

### Dry Run (Test Without Publishing)
```bash
# Main SDK
cd sdks/typescript
npm pack --dry-run

# Babel Plugin
cd sdks/typescript/babel-plugin
npm pack --dry-run
```

### Publish to npm
```bash
# Main SDK
cd sdks/typescript
npm publish --access public

# Babel Plugin
cd sdks/typescript/babel-plugin
npm publish --access public
```

## Post-Publish Verification

After publishing, verify:

1. **Installation works:**
   ```bash
   npm install @mode-7/raceway-node
   npm install --save-dev babel-plugin-raceway
   ```

2. **Documentation is visible on npm:**
   - https://www.npmjs.com/package/@mode-7/raceway-node
   - https://www.npmjs.com/package/babel-plugin-raceway

3. **Runtime module is accessible:**
   ```typescript
   import { initializeRuntime } from '@mode-7/raceway-node/runtime';
   ```

4. **Types work correctly:**
   ```typescript
   import { Raceway, RacewayConfig } from '@mode-7/raceway-node';
   ```

## Version Bumping

For future releases:

```bash
# Patch (0.1.0 -> 0.1.1)
npm version patch

# Minor (0.1.0 -> 0.2.0)
npm version minor

# Major (0.1.0 -> 1.0.0)
npm version major
```

## Notes

- Both packages are scoped/unscoped accordingly
- Main SDK uses scoped name: `@mode-7/raceway-node`
- Babel plugin uses standard name: `babel-plugin-raceway` (follows Babel convention)
- All builds are clean and ready for publishing
- Documentation is comprehensive and included in packages
