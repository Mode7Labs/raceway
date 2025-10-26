# Full-Stack Banking Demo - Scoping Document

## Executive Summary

This document scopes a comprehensive full-stack banking application that demonstrates Raceway's race detection, lock contention analysis, and distributed tracing capabilities across a realistic microservices architecture.

**Objective**: Build a production-quality demo that showcases Raceway's ability to detect concurrency issues in real-world distributed systems.

**Complexity**: Medium-High (2-3 week effort for full implementation)

---

## Architecture Overview

### Frontend Application
**Technology**: Vanilla JS/HTML/CSS or lightweight React
**Port**: 3000

**Features**:
- Customer banking interface (view accounts, transfer money, transaction history)
- Admin control panel with scenario triggers
- Real-time transaction feed
- Integration with Raceway Web UI (iframe or separate tab)

**Pages**:
1. **Login** - Authentication
2. **Dashboard** - Account overview, balance
3. **Transfer** - Move money between accounts
4. **History** - Transaction log
5. **Admin Panel** - Trigger race conditions, load tests, view system health

---

### Backend Microservices (4 Services)

#### 1. Account Service (Go)
**Port**: 7001
**SDK**: Go Raceway SDK

**Responsibilities**:
- Manage account data (create, read, update)
- Enforce account balance constraints
- Handle overdraft checks
- Provide account locks for transactions

**Database**: PostgreSQL
- Table: `accounts (id, user_id, balance, created_at, updated_at)`

**Endpoints**:
- `GET /accounts/:id` - Get account details
- `GET /accounts/user/:user_id` - Get user's accounts
- `PATCH /accounts/:id/balance` - Update balance (with lock)
- `POST /accounts/:id/lock` - Acquire account lock
- `POST /accounts/:id/unlock` - Release account lock

**Instrumentation**:
- Database queries (read/write)
- Lock acquire/release
- State changes (balance updates)
- HTTP requests/responses

**Race Scenarios**:
- Concurrent balance updates causing overdrafts
- Lost updates (read-modify-write without proper locking)

---

#### 2. Transaction Service (Python/Flask)
**Port**: 7002
**SDK**: Python Raceway SDK

**Responsibilities**:
- Orchestrate money transfers
- Create transaction records
- Coordinate with Account Service
- Handle transaction rollbacks

**Database**: PostgreSQL
- Table: `transactions (id, from_account, to_account, amount, status, created_at)`

**Endpoints**:
- `POST /transactions/transfer` - Initiate transfer
- `GET /transactions/:id` - Get transaction details
- `GET /transactions/account/:account_id` - Get account transaction history
- `POST /transactions/:id/rollback` - Reverse transaction

**Instrumentation**:
- Database queries
- HTTP calls to Account Service
- State changes (transaction status)
- Function calls (transfer logic)
- Distributed tracing headers

**Race Scenarios**:
- Concurrent transfers from same account
- Deadlocks (A→B and B→A simultaneously)
- Partial failures with inconsistent state

---

#### 3. Notification Service (TypeScript/Express)
**Port**: 7003
**SDK**: TypeScript Raceway SDK

**Responsibilities**:
- Send transaction notifications (email/SMS simulation)
- Track notification delivery status
- Rate limiting and queuing
- Async job processing

**Database**: Redis
- Keys: `notifications:pending`, `notifications:sent`, `rate_limit:{user_id}`

**Endpoints**:
- `POST /notifications/send` - Queue notification
- `GET /notifications/:id/status` - Check delivery status
- `POST /notifications/process` - Process pending queue (internal)

**Instrumentation**:
- Async spawn/await (job processing)
- Redis operations
- HTTP requests
- Rate limiting logic
- Queue operations

**Race Scenarios**:
- Duplicate notifications due to queue processing race
- Rate limit bypass with concurrent requests
- Lost notifications in queue

---

#### 4. Auth Service (Rust/Axum)
**Port**: 7004
**SDK**: Rust Raceway SDK

**Responsibilities**:
- User authentication (JWT tokens)
- Session management
- Authorization checks
- Security audit logging

**Database**: Redis
- Keys: `sessions:{token}`, `users:{user_id}`, `audit:{user_id}`

**Endpoints**:
- `POST /auth/login` - Authenticate user
- `POST /auth/logout` - Invalidate session
- `GET /auth/verify` - Validate JWT token
- `GET /auth/audit/:user_id` - Get audit log

**Instrumentation**:
- Function calls (crypto operations)
- Redis operations
- State changes (session creation/deletion)
- Lock acquire/release (for rate limiting)

**Race Scenarios**:
- Session fixation with concurrent logins
- Audit log corruption with parallel writes
- Token refresh race conditions

---

## Database Schema

### PostgreSQL (Shared by Account & Transaction Services)

```sql
-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Accounts table
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    balance DECIMAL(12, 2) NOT NULL CHECK (balance >= 0),
    account_type VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    version INT NOT NULL DEFAULT 1 -- Optimistic locking
);

-- Transactions table
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_account UUID REFERENCES accounts(id),
    to_account UUID REFERENCES accounts(id),
    amount DECIMAL(12, 2) NOT NULL,
    status VARCHAR(20) NOT NULL, -- pending, completed, failed, rolled_back
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_accounts_user ON accounts(user_id);
CREATE INDEX idx_transactions_from ON transactions(from_account);
CREATE INDEX idx_transactions_to ON transactions(to_account);
CREATE INDEX idx_transactions_status ON transactions(status);
```

### Redis (Used by Notification & Auth Services)

```
# Sessions (Auth Service)
sessions:{token} -> {user_id, expires_at}

# Users cache (Auth Service)
users:{user_id} -> {username, email, roles}

# Audit logs (Auth Service)
audit:{user_id} -> [log_entry_1, log_entry_2, ...]

# Notification queue (Notification Service)
notifications:pending -> [notification_1, notification_2, ...]
notifications:sent -> {notification_id: timestamp}

# Rate limiting (Notification Service)
rate_limit:{user_id}:{window} -> count
```

---

## Scenario Triggers (Admin Panel)

### 1. Classic Race Condition: Concurrent Transfers
**Trigger**: "Race: Concurrent Transfers"

**What happens**:
- 5 concurrent transfers from the same account
- Each transfer amount = 80% of balance
- Expected: Only 1 succeeds, others fail
- **Without proper locking**: Multiple succeed → overdraft

**Instrumentation Shows**:
- Race conditions in Transaction Service
- Lock contention in Account Service
- State change conflicts

---

### 2. Distributed Deadlock
**Trigger**: "Deadlock: Circular Transfers"

**What happens**:
- User A transfers to User B
- User B transfers to User A (simultaneously)
- Both services try to lock both accounts
- Different lock ordering → deadlock

**Instrumentation Shows**:
- Lock acquisition timeline
- Blocked threads waiting
- Deadlock detection
- Timeout/rollback

---

### 3. Lost Update Problem
**Trigger**: "Race: Lost Updates"

**What happens**:
- Multiple transactions read account balance
- Each calculates new balance
- Each writes back (last write wins)
- **Without optimistic locking**: Updates lost

**Instrumentation Shows**:
- Read-modify-write pattern
- Concurrent state changes
- Version mismatch failures (if using optimistic locking)

---

### 4. Notification Duplication
**Trigger**: "Race: Duplicate Notifications"

**What happens**:
- Transaction completes
- Multiple workers process notification queue
- Same notification sent twice

**Instrumentation Shows**:
- Queue processing race
- Duplicate async spawns
- Idempotency issues

---

### 5. Slow Query Cascade
**Trigger**: "Anomaly: Slow Queries"

**What happens**:
- Inject 2-second delay in database queries
- Trigger multiple concurrent transactions
- Services timeout and retry
- Cascading failures

**Instrumentation Shows**:
- Query duration anomalies
- Timeout events
- Retry storms
- Circuit breaker activation (if implemented)

---

### 6. Authentication Race
**Trigger**: "Race: Session Fixation"

**What happens**:
- User logs in from multiple devices simultaneously
- Session tokens generated concurrently
- Session cache corruption

**Instrumentation Shows**:
- Concurrent session creation
- Cache write conflicts
- Audit log races

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
**Complexity**: Medium
**Time**: 5-7 days

**Tasks**:
1. Set up project structure
2. Configure Docker Compose (4 services + PostgreSQL + Redis + Raceway)
3. Implement basic Account Service (Go)
   - Database connection
   - CRUD endpoints
   - Raceway SDK integration
4. Implement basic Transaction Service (Python)
   - Database connection
   - Transfer endpoint (simple, no locking yet)
   - Raceway SDK integration
5. Create simple frontend (HTML/JS)
   - Login page
   - Transfer form
   - Transaction list

**Deliverable**: Basic working app with 2 services, no race protection

---

### Phase 2: Add Services & Instrumentation (Week 1-2)
**Complexity**: Medium
**Time**: 4-5 days

**Tasks**:
1. Implement Notification Service (TypeScript)
   - Redis queue
   - Async processing
   - Raceway SDK integration
2. Implement Auth Service (Rust)
   - JWT authentication
   - Session management
   - Raceway SDK integration
3. Add comprehensive instrumentation to all services:
   - Database queries
   - Lock acquire/release
   - State changes
   - HTTP calls
   - Async operations

**Deliverable**: 4 services with full Raceway instrumentation

---

### Phase 3: Race Scenarios (Week 2)
**Complexity**: Medium-High
**Time**: 5-6 days

**Tasks**:
1. Implement lock mechanisms in Account Service
2. Add scenario triggers in admin panel
3. Create race condition #1: Concurrent transfers
4. Create race condition #2: Deadlock
5. Create race condition #3: Lost updates
6. Create race condition #4: Notification duplication
7. Test and validate all scenarios with Raceway

**Deliverable**: All 6 scenarios working and detectable by Raceway

---

### Phase 4: Polish & Documentation (Week 3)
**Complexity**: Low-Medium
**Time**: 3-4 days

**Tasks**:
1. Improve frontend UI (optional: upgrade to React)
2. Add admin panel visualizations
3. Create Docker Compose one-command setup
4. Write comprehensive README
5. Create demo video/screenshots
6. Add health checks and monitoring
7. Seed sample data

**Deliverable**: Production-ready demo with documentation

---

## Technology Stack

### Frontend
- **Option A (Simple)**: Vanilla JS + HTML + Tailwind CSS
- **Option B (Advanced)**: React + Vite + Tailwind CSS

### Backend Services
1. **Account Service**: Go 1.21+ + chi/gin router + pgx (PostgreSQL)
2. **Transaction Service**: Python 3.11+ + Flask + psycopg2
3. **Notification Service**: TypeScript + Express + ioredis
4. **Auth Service**: Rust + Axum + redis-rs

### Infrastructure
- **PostgreSQL 15**: Shared database
- **Redis 7**: Cache and queues
- **Docker Compose**: Orchestration
- **Raceway Server**: Race detection backend

---

## Complexity Analysis

### Low Complexity Components ⭐
- Frontend HTML/JS pages
- Basic CRUD endpoints
- Docker Compose setup
- Seed data scripts

### Medium Complexity Components ⭐⭐
- Service-to-service communication
- Database schema design
- Raceway SDK integration (each service)
- JWT authentication
- Redis operations
- Basic race scenarios

### High Complexity Components ⭐⭐⭐
- Lock mechanism implementation
- Deadlock scenario
- Distributed transaction coordination
- Queue processing with race protection
- Async notification handling
- Comprehensive instrumentation

---

## Effort Estimation

### By Role

**Backend Developer (Go/Python/TypeScript/Rust)**:
- Phase 1: 3-4 days
- Phase 2: 4-5 days
- Phase 3: 4-5 days
- Phase 4: 2-3 days
- **Total**: 13-17 days

**Frontend Developer**:
- Phase 1: 2-3 days
- Phase 2: 1 day
- Phase 3: 2 days
- Phase 4: 2-3 days
- **Total**: 7-9 days

**DevOps/Infrastructure**:
- Phase 1: 1-2 days
- Phase 2: 1 day
- Phase 3: 1 day
- Phase 4: 1-2 days
- **Total**: 4-6 days

### Minimum Viable Demo (MVP)

**Scope Reduction**:
- Only 2 services (Account + Transaction)
- 2 race scenarios instead of 6
- Simple HTML frontend (no React)
- No Auth Service (hardcode user)
- No Notification Service

**MVP Effort**: 1 week (single developer)

---

## Reusing Existing Code

### Can Leverage
1. **Banking examples** (`python-banking`, `go-banking`, `rust-banking`, `express-banking`)
   - Account models
   - Transfer logic
   - Basic UI components

2. **Distributed example** (`examples/distributed`)
   - Service structure
   - Docker Compose setup
   - SDK middleware integration
   - Test patterns

3. **Raceway Web UI**
   - Already has trace visualization
   - Already has lock contention view
   - Can embed or link from admin panel

### Need to Build From Scratch
1. Frontend banking UI
2. Admin scenario triggers
3. Race condition implementations
4. Lock coordination logic
5. Service orchestration code
6. Comprehensive instrumentation

---

## Success Criteria

### Functional Requirements
✅ Users can create accounts and transfer money
✅ All 4 services communicate via HTTP
✅ All 6 race scenarios can be triggered
✅ Frontend admin panel controls scenarios

### Raceway Integration
✅ All services send events to Raceway server
✅ Distributed tracing works across services
✅ Race conditions are detected and visualized
✅ Lock contention is tracked and displayed
✅ Query anomalies are detected

### Demo Quality
✅ One-command Docker Compose startup
✅ Seed data auto-populated
✅ README with clear instructions
✅ Screenshots/video showing each scenario

---

## Risks & Mitigations

### Risk 1: SDK Feature Gaps
**Risk**: SDKs missing lock tracking or database instrumentation
**Impact**: High - core demo functionality
**Mitigation**:
- Audit SDK capabilities first (Phase 0)
- Add missing features to SDKs if needed
- Use manual event creation as fallback

### Risk 2: Distributed Coordination Complexity
**Risk**: Deadlock and distributed race scenarios are hard to implement reliably
**Impact**: Medium - some scenarios may not work
**Mitigation**:
- Start with simpler race scenarios
- Use proven patterns (2PC, Sagas)
- Test thoroughly with chaos engineering

### Risk 3: Performance Issues
**Risk**: 4 services + 2 databases + Raceway = resource heavy
**Impact**: Low - demo runs locally
**Mitigation**:
- Optimize Docker Compose resource limits
- Use connection pooling
- Add health checks and graceful degradation

### Risk 4: Time Overrun
**Risk**: Complexity underestimated
**Impact**: Medium - delayed demo
**Mitigation**:
- Build MVP first (1 week)
- Add scenarios incrementally
- Cut scope if needed (fewer services/scenarios)

---

## Recommended Approach

### Start with MVP (1 Week)
1. Account Service (Go) + Transaction Service (Python)
2. PostgreSQL database
3. Simple HTML frontend
4. 2 race scenarios: concurrent transfers + lost updates
5. Basic Raceway instrumentation

### Expand to Full Demo (Additional 2 Weeks)
1. Add Notification Service (TypeScript)
2. Add Auth Service (Rust)
3. Implement all 6 scenarios
4. Polish UI
5. Complete documentation

This phased approach allows early validation and iterative improvement.

---

## Next Steps

1. **Decision**: MVP or Full Demo?
2. **Assign**: Who will build this?
3. **Timeline**: When should this be ready?
4. **Review**: SDK capability audit (are all features available?)
5. **Kickoff**: Create project repo and initial structure

---

## Questions to Resolve

1. Should we use the existing `examples/distributed` as a starting point?
2. Do we want a real frontend framework (React) or simple HTML?
3. Should Auth Service use JWT or sessions?
4. Do we need persistent Raceway storage (Postgres) or in-memory?
5. Should this demo be deployable to cloud (AWS/GCP) or local-only?
6. Do we want to add more advanced scenarios (Byzantine faults, split-brain, etc.)?

---

**Document Version**: 1.0
**Last Updated**: 2025-10-25
**Author**: Claude (via scoping analysis)
