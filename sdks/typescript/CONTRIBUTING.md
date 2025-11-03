# Contributing to Raceway TypeScript SDK

Thank you for your interest in contributing to Raceway! This document outlines the development process, coding standards, and areas where we need help.

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and npm
- TypeScript 5.0+
- Jest for testing
- Babel 7+ (for plugin development)

### Setup

```bash
# Clone the repository
git clone https://github.com/mode-7/raceway.git
cd raceway/sdks/typescript

# Install dependencies
npm install

# Build the SDK
npm run build

# Run tests
npm test

# Watch mode during development
npm run watch
```

### Project Structure

```
sdks/typescript/
├── src/                    # Main SDK source
│   ├── index.ts           # Public API exports
│   ├── raceway.ts         # Core SDK class
│   ├── client.ts          # HTTP client
│   ├── runtime.ts         # Runtime module for Babel plugin
│   ├── auto-track.ts      # Proxy-based tracking
│   ├── trace-context.ts   # W3C trace context handling
│   ├── types.ts           # TypeScript type definitions
│   └── *.test.ts          # Test files
├── babel-plugin/          # Babel plugin for auto-instrumentation
│   └── src/
│       └── index.ts       # Plugin implementation
├── dist/                  # Compiled output (generated)
├── README.md              # Main documentation
├── INSTRUMENTATION-GUIDE.md  # Detailed usage guide
└── CONTRIBUTING.md        # This file
```

## 🧪 Testing

We maintain 100% test coverage. All contributions must include tests.

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- src/middleware.test.ts

# Run with coverage
npm test -- --coverage
```

### Test Categories

- **Unit Tests**: Test individual functions and methods
- **Integration Tests**: Test SDK interactions with mocked client
- **Middleware Tests**: Test Express/Connect middleware behavior
- **Babel Plugin Tests**: Test code transformations

### Writing Tests

Follow the existing test patterns:

```typescript
describe('Feature Name', () => {
  let raceway: Raceway;
  let mockClient: any;
  let capturedEvents: any[];

  beforeEach(() => {
    capturedEvents = [];
    mockClient = {
      bufferEvent: jest.fn((event) => capturedEvents.push(event)),
      flush: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn(),
    };
    raceway = new Raceway({
      serverUrl: 'http://localhost:8080',
      serviceName: 'test-service',
    });
    (raceway as any).client = mockClient;
  });

  it('should do something specific', () => {
    const middleware = raceway.middleware();
    const mockReq: any = { method: 'GET', url: '/test', headers: {} };
    const mockRes: any = {};

    middleware(mockReq, mockRes, () => {
      // Your test logic here
      expect(capturedEvents.length).toBeGreaterThan(0);
    });
  });
});
```

## 📝 Coding Standards

### TypeScript

- Use strict TypeScript with no implicit `any`
- Export all public types and interfaces
- Document complex types with JSDoc comments
- Prefer `interface` over `type` for object shapes

### Code Style

- 2 spaces for indentation
- Single quotes for strings
- Semicolons required
- Max line length: 100 characters
- Use meaningful variable names

### Naming Conventions

- **Classes**: PascalCase (`Raceway`, `RacewayClient`)
- **Functions/Methods**: camelCase (`trackStateChange`, `middleware`)
- **Constants**: UPPER_SNAKE_CASE (`DEFAULT_BATCH_SIZE`)
- **Types/Interfaces**: PascalCase (`RacewayConfig`, `Event`)
- **Private members**: prefix with underscore (`_client`)

### Documentation

- Add JSDoc comments to all public APIs
- Include `@param`, `@returns`, `@throws` tags
- Provide usage examples for complex functions
- Keep README.md updated with API changes

## 🎯 Areas We Need Help

### High Priority

#### 1. TypeScript Decorator Support (Stage 3 ECMAScript)

**Status**: Stage 3 proposal, shipping in TypeScript 5.0+

Add decorator-based instrumentation as a fourth approach:

```typescript
import { Track, TrackLock, TraceFunction } from '@mode-7/raceway/decorators';

class BankAccount {
  @Track() // Auto-track property access
  private balance: number = 1000;

  @TraceFunction() // Auto-trace method calls
  async transfer(to: BankAccount, amount: number) {
    this.balance -= amount;
    to.balance += amount;
  }

  @TrackLock('account_mutex')
  async withdraw(amount: number) {
    // Lock automatically tracked
    this.balance -= amount;
  }
}
```

**Implementation Tasks**:
- Create `src/decorators.ts` with decorator factories
- Support class properties, methods, and accessors
- Integrate with existing AsyncLocalStorage context
- Add tests for decorator behavior
- Update documentation with decorator examples

**Files to Create**:
- `src/decorators.ts` - Decorator implementations
- `src/decorators.test.ts` - Decorator tests
- `DECORATOR-GUIDE.md` - Decorator usage guide

**References**:
- [TC39 Decorators Proposal](https://github.com/tc39/proposal-decorators)
- [TypeScript Decorators](https://www.typescriptlang.org/docs/handbook/decorators.html)

#### 2. WebAssembly Support

Add WASM instrumentation for performance-critical paths:

```typescript
raceway.trackWasm(wasmModule, 'myModule');
```

**Tasks**:
- Intercept WASM memory access
- Track WASM function calls
- Bridge WASM → JS event pipeline

#### 3. Source Map Support for Babel Plugin

Improve debugging experience by generating source maps:

**Tasks**:
- Generate source maps during transformation
- Map instrumented code back to original source
- Update Babel plugin to preserve location info

#### 4. Streaming Event API

Add real-time event streaming alternative to batching:

```typescript
const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  streaming: true, // WebSocket connection
});
```

**Tasks**:
- WebSocket client implementation
- Fallback to HTTP when WS unavailable
- Backpressure handling

### Medium Priority

#### 5. React Hooks Integration

Create React-specific helpers:

```typescript
import { useRaceway, useTrackedState } from '@mode-7/raceway-react';

function Counter() {
  const raceway = useRaceway();
  const [count, setCount] = useTrackedState(0, 'counter');
  // State changes automatically tracked!
}
```

**Tasks**:
- Create separate package: `@mode-7/raceway-react`
- Implement `useTrackedState`, `useTrackedReducer` hooks
- Context provider for Raceway instance

#### 6. Database Integration Helpers

Add helpers for popular ORMs:

```typescript
// Prisma
import { trackPrisma } from '@mode-7/raceway/prisma';
const prisma = trackPrisma(new PrismaClient());

// TypeORM
import { trackTypeORM } from '@mode-7/raceway/typeorm';
```

**Tasks**:
- Intercept query execution
- Track query parameters and results
- Measure query duration
- Support: Prisma, TypeORM, Sequelize, Knex

#### 7. GraphQL Integration

Auto-track GraphQL resolver execution:

```typescript
import { RacewayGraphQLExtension } from '@mode-7/raceway/graphql';

const server = new ApolloServer({
  extensions: [() => new RacewayGraphQLExtension()],
});
```

#### 8. OpenTelemetry Bridge

Bridge Raceway events to OpenTelemetry:

```typescript
const raceway = new Raceway({
  exporters: ['opentelemetry'],
  otelConfig: { /* ... */ }
});
```

**Tasks**:
- Map Raceway events to OTel spans
- Support OTel exporters
- Bidirectional context propagation

### Low Priority

#### 9. Performance Profiling Mode

Add lightweight profiling:

```typescript
const raceway = new Raceway({
  profiling: true,
  samplingRate: 0.1, // 10% sampling
});
```

#### 10. Event Filtering DSL

Allow filtering events before sending:

```typescript
const raceway = new Raceway({
  filter: {
    exclude: {
      variables: ['cache.*', 'temp.*'],
      functions: ['logger.*'],
    },
    include: {
      variables: ['account.*'],
    },
  },
});
```

#### 11. Snapshot Testing

Add snapshot capabilities for state:

```typescript
raceway.snapshot('checkpoint_1');
// ... operations ...
raceway.snapshot('checkpoint_2');
```

#### 12. Browser/Client-Side Support

Create browser-compatible build:

```typescript
import { Raceway } from '@mode-7/raceway-browser';

const raceway = new Raceway({
  serverUrl: 'https://api.raceway.dev',
  beacon: true, // Use sendBeacon API
});
```

## 🔧 Development Workflow

### Making Changes

1. **Create a branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**:
   - Write code following coding standards
   - Add tests for new functionality
   - Update documentation

3. **Test your changes**:
   ```bash
   npm test
   npm run build
   ```

4. **Commit with clear messages**:
   ```bash
   git commit -m "feat: add decorator support for class properties"
   ```

   Use conventional commits:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `test:` - Test additions/changes
   - `refactor:` - Code refactoring
   - `perf:` - Performance improvements
   - `chore:` - Maintenance tasks

5. **Push and create PR**:
   ```bash
   git push origin feature/your-feature-name
   ```

### Pull Request Process

1. Ensure all tests pass (`npm test`)
2. Update README.md with API changes
3. Add entries to RELEASE-NOTES.md
4. Request review from maintainers
5. Address feedback
6. Squash commits if requested

### Review Criteria

PRs will be evaluated on:

- **Correctness**: Does it work as intended?
- **Tests**: Are there comprehensive tests?
- **Documentation**: Is it well-documented?
- **Performance**: Does it impact performance?
- **API Design**: Is the API intuitive?
- **Backward Compatibility**: Does it break existing code?

## 🐛 Bug Reports

### Before Submitting

1. Check existing issues
2. Verify it's not a configuration issue
3. Test with latest version
4. Create minimal reproduction

### What to Include

- **Description**: Clear description of the bug
- **Reproduction**: Minimal code to reproduce
- **Expected**: What should happen
- **Actual**: What actually happens
- **Environment**: Node version, OS, SDK version
- **Logs**: Relevant error messages/logs

### Example Bug Report

```markdown
## Description
`raceway.track()` doesn't track nested array mutations

## Reproduction
\`\`\`typescript
const state = raceway.track({ items: [1, 2, 3] }, 'state');
state.items[0] = 10; // Not tracked
\`\`\`

## Expected
State change event for `state.items[0]`

## Actual
No event emitted

## Environment
- Node: 18.17.0
- SDK: 0.1.0
- OS: macOS 14.0
```

## 💡 Feature Requests

We welcome feature requests! Please:

1. Check if it already exists
2. Explain the use case
3. Provide examples
4. Consider implementation complexity

## 🏗️ Architecture Notes

### Context Propagation

We use AsyncLocalStorage (ALS) for automatic context propagation. This is the same approach as OpenTelemetry and provides:

- Automatic context across async boundaries
- No manual context passing
- Works with Promises, async/await, setTimeout, etc.

### Event Buffering

Events are buffered in memory and flushed periodically:

1. Events captured → Buffer
2. Buffer reaches `batchSize` OR `flushInterval` expires
3. HTTP POST to Raceway server
4. Retry on failure with exponential backoff

### Proxy-Based Tracking

The `track()` method uses JavaScript Proxies to intercept property access:

- `get` trap: Track reads
- `set` trap: Track writes (captures old value)
- Nested objects: Recursively wrap nested objects
- Performance: ~10-20% overhead (acceptable for dev/test)

## 📚 Resources

- [Main Raceway Repository](https://github.com/mode-7/raceway)
- [Documentation](https://docs.raceway.dev)
- [Issue Tracker](https://github.com/mode-7/raceway/issues)
- [Discussions](https://github.com/mode-7/raceway/discussions)

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## ❓ Questions?

- Open a [Discussion](https://github.com/mode-7/raceway/discussions)
- Join our [Discord](https://discord.gg/raceway) (if available)
- Email: dev@raceway.dev (if available)

Thank you for contributing to Raceway! 🎉
