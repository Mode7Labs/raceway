# Storage Options

Choose between in-memory and PostgreSQL storage for your Raceway deployment.

## Overview

Raceway supports two storage backends:

| Feature | In-Memory | PostgreSQL |
|---------|-----------|------------|
| **Setup** | None | Database required |
| **Persistence** | No | Yes |
| **Performance** | Fastest | Fast |
| **Scalability** | RAM-limited | Scalable |
| **Queries** | Limited | Full SQL |
| **Cost** | Free | Database cost |
| **Use Case** | Development/Testing | Production |

## In-Memory Storage (Default)

### Configuration

```toml
[storage]
backend = "memory"
```

### How It Works

- Events stored in **DashMap** (concurrent HashMap)
- All data in RAM
- No disk I/O
- Lost on restart

### Advantages

- **Fast**: No disk/network overhead
- **Simple**: No setup required
- **Free**: No database costs
- **Portable**: Works anywhere

### Limitations

- **No persistence**: Data lost on restart
- **RAM-limited**: Size limited by available memory
- **Single instance**: No clustering

### Best For

- Local development
- Testing and CI/CD
- Demos
- Temporary analysis

### Capacity Estimate

```
Average event size: ~500 bytes
1 GB RAM ≈ 2 million events
10 GB RAM ≈ 20 million events
```

## PostgreSQL Storage

### Setup

1. **Create database:**

```sql
CREATE DATABASE raceway;
CREATE USER raceway WITH PASSWORD 'password';
GRANT ALL PRIVILEGES ON DATABASE raceway TO raceway;
```

2. **Configure Raceway:**

```toml
[storage]
backend = "postgres"

[storage.postgres]
connection_string = "postgresql://raceway:password@localhost:5432/raceway"
max_connections = 10
```

3. **Run migrations:**

```bash
cargo run -- migrate
```

### Schema

```sql
-- Traces table
CREATE TABLE traces (
    trace_id VARCHAR(255) PRIMARY KEY,
    service_name VARCHAR(255),
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    event_count INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Events table
CREATE TABLE events (
    event_id VARCHAR(255) PRIMARY KEY,
    trace_id VARCHAR(255) REFERENCES traces(trace_id),
    kind VARCHAR(50),
    timestamp TIMESTAMP,
    duration_ms REAL,
    location VARCHAR(500),
    vector_clock JSONB,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_events_trace_id ON events(trace_id);
CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_traces_service ON traces(service_name);
```

### Advantages

- **Persistent**: Survives restarts
- **Scalable**: Handle millions of events
- **Queryable**: Full SQL power
- **Backup**: Standard database backups
- **Multi-instance**: Shared storage for clustering

### Configuration Options

```toml
[storage]
backend = "postgres"

[storage.postgres]
connection_string = "postgresql://user:pass@host:port/db"
max_connections = 20
min_connections = 5
connection_timeout_seconds = 30
```

### Performance Tuning

**PostgreSQL settings:**

```sql
-- Increase shared buffers
shared_buffers = '256MB'

-- Increase work memory
work_mem = '50MB'

-- Increase effective cache
effective_cache_size = '1GB'

-- Optimize for writes
wal_buffers = '16MB'
checkpoint_completion_target = 0.9
```

**Indexing:**

```sql
-- Add indexes for common queries
CREATE INDEX idx_events_kind ON events(kind);
CREATE INDEX idx_events_location ON events(location);

-- Partial indexes for performance
CREATE INDEX idx_recent_traces ON traces(created_at)
  WHERE created_at > NOW() - INTERVAL '7 days';
```

### Connection Pooling

```toml
[storage]
backend = "postgres"

[storage.postgres]
connection_string = "postgresql://..."
max_connections = 20             # Max connections in pool
min_connections = 5              # Keep-alive connections
connection_timeout_seconds = 30  # Connection acquire timeout
```

## Supabase Storage

Raceway works with Supabase (PostgreSQL-compatible):

```toml
[storage]
backend = "supabase"

[storage.postgres]
connection_string = "postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres"
```

**Features:**
- Managed PostgreSQL
- Automatic backups
- Web dashboard
- API access

## Migration Between Storage Types

### From In-Memory to PostgreSQL

1. **Setup PostgreSQL** as described above
2. **Update configuration:**

```toml
[storage]
backend = "postgres"

[storage.postgres]
connection_string = "postgresql://..."
```

3. **Restart Raceway** - New events go to PostgreSQL
4. **Note:** Old in-memory data is lost (export first if needed)

### Exporting Data

```bash
# Export all traces to JSON
curl http://localhost:8080/api/traces > traces.json

# Import to new instance (manual process)
```

## Data Retention

### In-Memory

In-memory storage retains all data until the server is restarted or runs out of memory.

::: warning No Automatic Cleanup
In-memory storage does not currently support automatic cleanup based on trace count or age. Data is retained until restart.

**Want to contribute?** Adding configurable retention policies for in-memory storage is a [good first issue](https://github.com/mode7labs/raceway/issues).
:::

### PostgreSQL

Manual cleanup with cron:

```sql
-- Delete traces older than 30 days
DELETE FROM traces
WHERE created_at < NOW() - INTERVAL '30 days';

-- Vacuum to reclaim space
VACUUM ANALYZE traces;
VACUUM ANALYZE events;
```

Or use pg_cron:

```sql
CREATE EXTENSION pg_cron;

-- Run cleanup daily at 2 AM
SELECT cron.schedule(
  'cleanup-old-traces',
  '0 2 * * *',
  $$DELETE FROM traces WHERE created_at < NOW() - INTERVAL '30 days'$$
);
```

## Backup and Recovery

### PostgreSQL Backups

```bash
# Backup
pg_dump raceway > raceway_backup.sql

# Restore
psql raceway < raceway_backup.sql

# Continuous archiving
# Configure PostgreSQL WAL archiving
```

### Automated Backups

Use PostgreSQL backup tools:
- pgBackRest
- Barman
- Cloud provider snapshots (AWS RDS, Google Cloud SQL)

## Monitoring

### PostgreSQL Metrics

Monitor:
- Connection pool usage
- Query performance
- Disk space
- Index effectiveness
- Replication lag (if using replicas)

**Queries:**

```sql
-- Active connections
SELECT count(*) FROM pg_stat_activity WHERE datname = 'raceway';

-- Table sizes
SELECT pg_size_pretty(pg_total_relation_size('events'));

-- Slow queries
SELECT query, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## Next Steps

- [Configuration](/guide/configuration) - Configure storage settings
- [Security](/guide/security) - Secure your storage
- [Getting Started](/guide/getting-started) - Initial setup
