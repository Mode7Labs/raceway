# Instrumentation: Current State & Next Steps

## TL;DR

**Current State:** Raceway has solid causality tracking and race detection, but requires **manual instrumentation** for most events.

**The Gap:** Developers must manually call `track_state_change()`, `track_lock_acquire()`, etc. This is tedious and error-prone.

**The Goal:** Move toward automatic instrumentation so developers get powerful concurrency analysis with minimal code changes.

---

## Current Instrumentation Matrix

### What's Automatic

| SDK | HTTP Requests | HTTP Responses | Function Entry | State Changes | Locks | Async Ops |
|-----|--------------|----------------|----------------|---------------|-------|-----------|
| Python | ✅ (middleware) | ✅ (middleware) | ❌ | ❌ | ❌ | ❌ |
| TypeScript | ✅ (middleware) | ✅ (middleware) | ❌ | ❌ | ❌ | ❌ |
| Go | ✅ (middleware) | ✅ (middleware) | ❌ | ❌ | ❌ | ❌ |
| Rust | ✅ (middleware) | ✅ (middleware) | ❌ | ❌ | ❌ | ❌ |

**Summary:** Only HTTP request/response tracking is automatic via framework middleware.

### What Requires Manual Tracking

**Critical for Race Detection:**
```python
# State Changes - MUST BE MANUAL
balance = accounts[user]["balance"]
client.track_state_change(f"{user}.balance", None, balance, "Read")  # 😞

accounts[user]["balance"] -= amount
client.track_state_change(f"{user}.balance", balance, new_balance, "Write")  # 😞

# Lock Tracking - MUST BE MANUAL
lock.acquire()
client.track_lock_acquire("account_lock", "Mutex")  # 😞
try:
    # critical section
finally:
    lock.release()
    client.track_lock_release("account_lock", "Mutex")  # 😞
```

**Nice to Have:**
```python
# Function calls - MUST BE MANUAL
client.track_function_call("process_payment", {"amount": 100})  # 😞

# Async operations - MUST BE MANUAL
task_id = client.track_async_spawn("background_job")  # 😞
await do_work()
client.track_async_await(task_id)  # 😞
```

---

## Why This Matters

### Current User Experience

**What developers must do:**
```python
# Before: Simple code
balance = account.balance
account.balance -= amount

# After: Raceway instrumentation
balance = account.balance
client.track_state_change("account.balance", None, balance, "Read")  # 😞
account.balance -= amount
client.track_state_change("account.balance", balance, account.balance, "Write")  # 😞
```

**Problems:**
1. **Tedious:** Every variable access needs manual tracking
2. **Error-prone:** Easy to forget tracking calls
3. **Incomplete:** Miss race detection if you forget to track
4. **Noisy:** Doubles lines of code in critical sections

### What We Want

**Ideal experience:**
```python
# Option A: Decorator-based
@raceway.track_state("account.balance")
def transfer(account, amount):
    balance = account.balance      # ✅ Auto-tracked Read
    account.balance -= amount      # ✅ Auto-tracked Write

# Option B: Context manager
with raceway.track_variables(["account.balance"]):
    balance = account.balance      # ✅ Auto-tracked Read
    account.balance -= amount      # ✅ Auto-tracked Write

# Option C: Full auto-instrumentation
# Just enable Raceway, everything tracked automatically
raceway.enable_auto_instrumentation()
```

---

## SDK-Specific Improvement Roadmap

### 🐍 Python SDK - Auto-Instrumentation Strategy

#### Phase 1: Decorator-Based Tracking (Easiest)

**Status:** Not implemented
**Complexity:** Low
**Impact:** Medium

```python
# Decorator tracks all attribute access within function
@raceway.track_attrs("user.balance", "user.name")
def process_payment(user, amount):
    balance = user.balance      # Auto-tracked Read
    user.balance -= amount      # Auto-tracked Write

# Implementation: Use sys.settrace() to intercept attribute access
```

**Pros:**
- Simple to implement
- Explicit about what's tracked
- Works with existing code

**Cons:**
- Still requires manual decoration
- Limited to function scope

#### Phase 2: AST Transformation (Better)

**Status:** Not implemented
**Complexity:** Medium
**Impact:** High

```python
# Install import hook
import raceway.autoinstrument
raceway.autoinstrument.install()

# Now any module imported automatically gets instrumented
from myapp import models

user.balance = 100  # Auto-tracked Write
value = user.balance  # Auto-tracked Read
```

**Implementation:**
```python
# Hook into Python's import system
import sys
from importlib.abc import MetaPathFinder, Loader
import ast

class RacewayImportHook(MetaPathFinder, Loader):
    def find_module(self, fullname, path=None):
        # Intercept module loading

    def load_module(self, fullname):
        # Parse AST, inject tracking calls, compile
        tree = ast.parse(source)
        transformer = RacewayTransformer()
        new_tree = transformer.visit(tree)
        return compile(new_tree, filename, 'exec')
```

**Pros:**
- Fully automatic
- No code changes needed
- Can track all variable access

**Cons:**
- Complex to implement
- May have edge cases
- Performance overhead

#### Phase 3: Bytecode Instrumentation (Advanced)

**Status:** Research needed
**Complexity:** High
**Impact:** Very High

```python
# Monkey-patch object.__setattr__ and __getattribute__
# Track all attribute access system-wide
```

**Pros:**
- Most automatic
- Works with compiled code

**Cons:**
- Very complex
- May break some libraries
- Hard to debug

**Recommendation:** Start with Phase 1 (decorators), then Phase 2 (AST).

---

### 📘 TypeScript/Node SDK - Auto-Instrumentation Strategy

#### Phase 1: Proxy-Based Tracking (Easiest)

**Status:** Not implemented
**Complexity:** Low
**Impact:** Medium

```typescript
// Wrap objects in tracking proxy
const user = raceway.track({
  balance: 1000,
  name: "Alice"
});

user.balance -= 100;  // ✅ Auto-tracked Write
const bal = user.balance;  // ✅ Auto-tracked Read

// Implementation:
export function track<T extends object>(obj: T, varName: string): T {
  return new Proxy(obj, {
    get(target, prop) {
      const value = target[prop];
      raceway.trackStateChange(`${varName}.${String(prop)}`, null, value, 'Read');
      return value;
    },
    set(target, prop, value) {
      const oldValue = target[prop];
      target[prop] = value;
      raceway.trackStateChange(`${varName}.${String(prop)}`, oldValue, value, 'Write');
      return true;
    }
  });
}
```

**Pros:**
- Easy to implement
- Works with existing objects
- TypeScript-friendly

**Cons:**
- Must wrap objects manually
- Doesn't work with primitives
- Performance overhead

#### Phase 2: Babel/SWC Transform (Better)

**Status:** Partially implemented (incomplete)
**Complexity:** Medium
**Impact:** High

```javascript
// babel.config.js
module.exports = {
  plugins: [
    ['@raceway/babel-plugin', {
      trackVariables: ['user.balance', 'account.balance']
    }]
  ]
};

// Before transform:
user.balance -= 100;

// After transform:
const _old = user.balance;
user.balance -= 100;
raceway.trackStateChange('user.balance', _old, user.balance, 'Write');
```

**Implementation:**
```javascript
// Babel plugin that transforms AST
module.exports = function({ types: t }) {
  return {
    visitor: {
      AssignmentExpression(path) {
        // Inject tracking calls around assignments
      }
    }
  };
};
```

**Pros:**
- Build-time transformation
- No runtime overhead
- Works with existing code

**Cons:**
- Requires build step
- Complex AST manipulation
- May miss dynamic access

**Recommendation:** Start with Phase 1 (Proxy), then Phase 2 (Babel plugin).

---

### 🐹 Go SDK - Auto-Instrumentation Strategy

#### Phase 1: Code Generation (Best for Go)

**Status:** Not implemented
**Complexity:** Medium
**Impact:** High

```go
//go:generate raceway-gen -type=Account -track=Balance,Name

type Account struct {
    Balance int
    Name    string
}

// Generated code:
func (a *Account) SetBalance(val int) {
    old := a.Balance
    a.Balance = val
    raceway.TrackStateChange("Account.Balance", old, val, "Write")
}

func (a *Account) GetBalance() int {
    val := a.Balance
    raceway.TrackStateChange("Account.Balance", nil, val, "Read")
    return val
}
```

**Implementation:**
- Use `go:generate` with custom tool
- Parse struct definitions
- Generate getter/setter methods with tracking

**Pros:**
- Go-idiomatic (code generation is common)
- Type-safe
- Build-time, no runtime overhead

**Cons:**
- Requires code generation step
- Must use generated methods

#### Phase 2: Compiler Plugin (Advanced)

**Status:** Research needed
**Complexity:** Very High
**Impact:** Very High

**Note:** Go doesn't officially support compiler plugins. Would need to fork the compiler or use experimental tools.

**Recommendation:** Phase 1 (code generation) is the Go way.

---

### 🦀 Rust SDK - Auto-Instrumentation Strategy

#### Phase 1: Procedural Macros (Best for Rust)

**Status:** Not implemented
**Complexity:** Medium
**Impact:** High

```rust
use raceway::track;

#[track]
struct Account {
    balance: i64,
    name: String,
}

// Macro generates:
impl Account {
    fn set_balance(&mut self, val: i64) {
        let old = self.balance;
        self.balance = val;
        raceway::track_state_change("Account.balance", &old, &val, "Write");
    }

    fn get_balance(&self) -> i64 {
        raceway::track_state_change("Account.balance", None, &self.balance, "Read");
        self.balance
    }
}
```

**Implementation:**
```rust
#[proc_macro_derive(Track)]
pub fn track_derive(input: TokenStream) -> TokenStream {
    // Parse struct, generate tracking methods
}
```

**Pros:**
- Rust-idiomatic (macros are common)
- Compile-time, zero runtime overhead
- Type-safe

**Cons:**
- Requires using generated methods
- Can't intercept direct field access

#### Phase 2: MIR Instrumentation (Advanced)

**Status:** Research needed
**Complexity:** Very High
**Impact:** Very High

**Note:** Would require compiler plugin to instrument at MIR (Mid-level IR) level.

**Recommendation:** Phase 1 (proc macros) is the Rust way.

---

## Lock Tracking Improvements

### Current State (All SDKs)

```python
# Manual lock tracking
lock.acquire()
client.track_lock_acquire("my_lock", "Mutex")
try:
    # critical section
finally:
    lock.release()
    client.track_lock_release("my_lock", "Mutex")
```

### Improved Approaches

#### Python: Context Manager

```python
# Automatic lock tracking via context manager
with raceway.tracked_lock(my_lock, "my_lock"):
    # Lock acquire/release auto-tracked
    balance = account.balance
    account.balance -= 100
```

#### TypeScript: Decorator

```typescript
class BankAccount {
  @raceway.withLock('balance_lock')
  async transfer(amount: number) {
    // Lock acquire/release auto-tracked
    this.balance -= amount;
  }
}
```

#### Go: Defer Pattern

```go
func (a *Account) Transfer(amount int) {
    defer raceway.TrackLock(&a.mu, "account_lock")()  // Auto-releases
    a.mu.Lock()
    a.balance -= amount
    a.mu.Unlock()
}
```

#### Rust: RAII Wrapper

```rust
let _guard = raceway::TrackedMutex::new(&my_lock, "my_lock");
// Lock auto-tracked, auto-released on drop
```

---

## Async Operation Tracking

### Current State

```python
# Manual async tracking
async def background_job():
    task_id = client.track_async_spawn("bg_job")
    await do_work()
    client.track_async_await(task_id)
```

### Improved Approaches

#### Python: Async Context Manager

```python
@raceway.track_async
async def background_job():
    # Spawn/await auto-tracked
    await do_work()
```

#### TypeScript: Decorator

```typescript
class Worker {
  @raceway.trackAsync
  async processJob(job: Job) {
    // Async spawn/await auto-tracked
    await job.execute();
  }
}
```

---

## Priority Order for Implementation

### High Priority (Blocking Adoption)

1. **Python AST Transform** - Most requested, highest impact
2. **TypeScript Babel Plugin** - Complete partial implementation
3. **Lock tracking helpers** - Context managers, decorators

### Medium Priority (Nice to Have)

4. **Go code generation** - `go:generate` tool
5. **Rust procedural macros** - `#[derive(Track)]`
6. **Function call auto-tracking** - Decorators/middleware

### Low Priority (Advanced)

7. **Bytecode instrumentation** (Python)
8. **MIR instrumentation** (Rust)
9. **Compiler plugins** (Go)

---

## Success Metrics

### Before Auto-Instrumentation

```python
# 50 lines of business logic
# + 100 lines of manual tracking calls
# = 150 lines total
# Developer experience: 😞
```

### After Auto-Instrumentation

```python
# 50 lines of business logic
# + 5 lines of decorator/configuration
# = 55 lines total
# Developer experience: 😊
```

**Target:** Reduce instrumentation overhead from **2:1** to **10:1** (business logic:tracking).

---

## Open Questions

1. **Performance Impact:** What's acceptable overhead for auto-instrumentation?
   - AST transform: ~5-10% slower?
   - Proxy-based: ~20-30% slower?
   - Bytecode: ~10-15% slower?

2. **Granularity Control:** Should developers be able to disable tracking for specific variables?
   ```python
   @raceway.track(exclude=["temp_var", "cache"])
   def process():
       pass
   ```

3. **Library Compatibility:** How do we handle third-party libraries?
   - Track all library calls?
   - Only track user code?
   - Opt-in list of libraries?

4. **Production Safety:** Should auto-instrumentation be dev-only?
   - Sampling in production (1% of requests)?
   - Feature flags to enable/disable?

---

## Getting Started (For Contributors)

### Want to implement auto-instrumentation?

**Python AST Transform:**
1. Start with `sdks/python/raceway/autoinstrument.py`
2. Hook into import system via `sys.meta_path`
3. Parse AST, inject tracking calls
4. Test with banking demo

**TypeScript Babel Plugin:**
1. Start with `sdks/typescript/babel-plugin/` (exists but incomplete)
2. Implement AssignmentExpression visitor
3. Inject tracking calls around variable access
4. Test with express banking demo

**Lock Tracking Helpers:**
1. Add context managers to Python SDK
2. Add RAII wrappers to Rust SDK
3. Add decorators to TypeScript SDK
4. Update examples to use new helpers

---

## Conclusion

**Current State:** Raceway has excellent race detection, but manual instrumentation is a barrier to adoption.

**Next Steps:** Prioritize auto-instrumentation for Python and TypeScript (most requested languages).

**Timeline:**
- Q1 2024: Python decorators + context managers
- Q2 2024: Python AST transform (experimental)
- Q3 2024: TypeScript Babel plugin (complete implementation)
- Q4 2024: Go code generation + Rust proc macros

**Goal:** Make Raceway as easy to use as adding a middleware, while providing deep concurrency insights.

---

**Contributors:** See issues tagged `auto-instrumentation` for specific tasks.

**Questions?** Open a discussion in GitHub Discussions.
