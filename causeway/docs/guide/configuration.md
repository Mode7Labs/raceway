# Configuration

Configure Raceway for your deployment needs with TOML configuration files.

## Configuration File

Create `raceway.toml` in your project root:

```toml
[server]
host = "0.0.0.0"
port = 8080

[storage]
backend = "memory"  # or "postgres" or "supabase"

[server]
auth_enabled = false
cors_enabled = true
```

See `raceway.toml.example` in the repository for a complete annotated configuration file.

## Server Configuration

### Network Binding

```toml
[server]
host = "127.0.0.1"  # localhost only (default, secure)
port = 8080
```

**Production:**
```toml
[server]
host = "0.0.0.0"    # all interfaces
port = 8080
```

::: warning TLS/HTTPS Support
Native TLS support is not yet implemented. Use a reverse proxy (nginx, Caddy, Traefik) for HTTPS termination. See the [Security Guide](/guide/security#reverse-proxy-https) for details.

**Want to help?** This is a [priority issue for contributors](https://github.com/mode7labs/raceway/issues).
:::

## Storage Configuration

### In-Memory (Default)

```toml
[storage]
backend = "memory"
```

**Pros:**
- Fast
- No setup
- No dependencies

**Cons:**
- No persistence
- Limited by RAM

**Use for:** Development, testing

### PostgreSQL

```toml
[storage]
backend = "postgres"

[storage.postgres]
connection_string = "postgresql://user:pass@localhost/raceway"
max_connections = 10
min_connections = 2
connection_timeout_seconds = 30
auto_migrate = true
```

**Pros:**
- Persistent
- Scalable
- Queryable

**Cons:**
- Requires database
- Slightly slower

**Use for:** Production

### Supabase

```toml
[storage]
backend = "supabase"

[storage.postgres]
connection_string = "postgresql://postgres.xxx:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
max_connections = 10
```

Supabase uses the same PostgreSQL configuration as the postgres backend.

## Authentication

### Enable API Key Authentication

```toml
[server]
auth_enabled = true
api_keys = ["your-secret-key-here"]
```

**SDK configuration:**

::: code-group

```typescript [TypeScript]
const client = new RacewayClient({
  serverUrl: 'http://localhost:8080',
  apiKey: 'your-secret-key-here'
});
```

```python [Python]
client = RacewayClient(
    server_url='http://localhost:8080',
    api_key='your-secret-key-here'
)
```

:::

**HTTP requests:**
```bash
curl -H "Authorization: Bearer your-secret-key-here" \
  http://localhost:8080/api/traces
```

### Multiple API Keys

```toml
[server]
auth_enabled = true
api_keys = [
  "key-for-service-a",
  "key-for-service-b",
  "key-for-admin"
]
```

All keys have equal permissions. Use different keys per service for easier revocation.

## CORS Configuration

```toml
[server]
cors_enabled = true
cors_origins = [
  "http://localhost:3000",
  "https://app.example.com"
]
```

**Development (allow all):**
```toml
[server]
cors_enabled = true
cors_origins = ["*"]
```

**Disable CORS:**
```toml
[server]
cors_enabled = false
```

## Rate Limiting

```toml
[server]
rate_limit_enabled = true
rate_limit_rpm = 1000  # requests per minute
```

Applies globally to all endpoints. Clients exceeding the limit receive `429 Too Many Requests`.

## Event Processing

```toml
[engine]
buffer_size = 10000        # Event queue capacity
batch_size = 100           # Events per batch
flush_interval_ms = 100    # Batch flush frequency
```

**Tuning:**
- **buffer_size**: Larger = handle more concurrent events, more memory
- **batch_size**: Larger = better throughput, higher latency
- **flush_interval_ms**: Lower = more real-time, more CPU

## Analysis Settings

### Race Detection

```toml
[race_detection]
enabled = true
```

Analyzes conflicting concurrent accesses to shared state.

### Anomaly Detection

```toml
[anomaly_detection]
enabled = true
```

Detects performance anomalies and outliers.

### Distributed Tracing

```toml
[distributed_tracing]
enabled = true
```

Merges traces across service boundaries using W3C Trace Context.

## Logging

```toml
[logging]
level = "info"          # trace, debug, info, warn, error
include_modules = false # Include Rust module names in logs
```

**Log levels:**
- `trace`: Very verbose, includes all internal operations
- `debug`: Detailed information for debugging
- `info`: General informational messages (default)
- `warn`: Warning messages
- `error`: Error messages only

## Development Settings

```toml
[development]
cors_allow_all = false
```

Development-only toggles. Do not use in production.

## Example Configurations

### Development

```toml
[server]
host = "127.0.0.1"
port = 8080
auth_enabled = false
cors_enabled = true
cors_origins = ["*"]

[storage]
backend = "memory"

[logging]
level = "debug"
```

### Production

```toml
[server]
host = "0.0.0.0"
port = 8080
auth_enabled = true
api_keys = ["${RACEWAY_API_KEY}"]  # From environment
cors_enabled = true
cors_origins = ["https://app.company.com"]
rate_limit_enabled = true
rate_limit_rpm = 10000

[storage]
backend = "postgres"

[storage.postgres]
connection_string = "postgresql://raceway:${DB_PASSWORD}@db:5432/raceway"
max_connections = 20
auto_migrate = true

[engine]
buffer_size = 50000
batch_size = 500

[race_detection]
enabled = true

[anomaly_detection]
enabled = true

[distributed_tracing]
enabled = true

[logging]
level = "info"
include_modules = false
```

## Configuration Reference

### [server]

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | string | `"127.0.0.1"` | Network interface to bind |
| `port` | u16 | `8080` | TCP port to listen on |
| `verbose` | bool | `false` | Enable verbose output |
| `cors_enabled` | bool | `true` | Enable CORS middleware |
| `cors_origins` | array | `["*"]` | Allowed CORS origins |
| `rate_limit_enabled` | bool | `false` | Enable rate limiting |
| `rate_limit_rpm` | u32 | `1000` | Requests per minute limit |
| `auth_enabled` | bool | `false` | Require API key authentication |
| `api_keys` | array | `[]` | Valid API keys |

### [storage]

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `backend` | string | `"memory"` | Storage backend: `memory`, `postgres`, `supabase` |

### [storage.postgres]

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `connection_string` | string | none | PostgreSQL connection URL |
| `max_connections` | u32 | `10` | Maximum pool size |
| `min_connections` | u32 | `2` | Minimum pool size |
| `connection_timeout_seconds` | u32 | `30` | Connection timeout |
| `auto_migrate` | bool | `true` | Auto-run migrations on startup |

### [engine]

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `buffer_size` | usize | `10000` | Event buffer capacity |
| `batch_size` | usize | `100` | Events per batch |
| `flush_interval_ms` | u64 | `100` | Batch flush interval |

### [race_detection]

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Enable race detection |

### [anomaly_detection]

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Enable anomaly detection |

### [distributed_tracing]

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable distributed tracing |

### [logging]

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | string | `"info"` | Log level |
| `include_modules` | bool | `false` | Include module names |

### [development]

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cors_allow_all` | bool | `false` | Development CORS override |

## Next Steps

- [Storage Options](/guide/storage) - Choose storage backend
- [Security](/guide/security) - Secure your deployment
- [Getting Started](/guide/getting-started) - Initial setup
