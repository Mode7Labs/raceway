# Security

Secure your Raceway deployment with API keys, CORS, HTTPS, and best practices.

## API Key Authentication

### Enable Authentication

```toml
[server]
auth_enabled = true
api_keys = ["your-secret-key-here"]
```

### Generate Strong Keys

```bash
# Generate random API key (64 characters)
openssl rand -hex 32

# Or use UUID
uuidgen
```

Store keys securely in environment variables, never commit them to source control.

### SDK Configuration

All SDKs support API keys:

::: code-group

```typescript [TypeScript]
const client = new RacewayClient({
  serverUrl: 'http://localhost:8080',
  apiKey: process.env.RACEWAY_API_KEY
});
```

```python [Python]
client = RacewayClient(
    server_url='http://localhost:8080',
    api_key=os.environ['RACEWAY_API_KEY']
)
```

```go [Go]
client := raceway.NewClient(raceway.Config{
    ServerURL: "http://localhost:8080",
    APIKey:    os.Getenv("RACEWAY_API_KEY"),
})
```

```rust [Rust]
let client = RacewayClient::new(Config {
    server_url: "http://localhost:8080".to_string(),
    api_key: Some(env::var("RACEWAY_API_KEY")?),
    ..Default::default()
});
```

:::

### HTTP Headers

The API key must be sent in the `Authorization` header:

```bash
curl -H "Authorization: Bearer your-api-key" \
  http://localhost:8080/api/traces
```

## CORS Configuration

### Allow Specific Origins

```toml
[server]
cors_enabled = true
cors_origins = [
  "https://app.company.com",
  "https://dashboard.company.com"
]
```

### Development Setup

```toml
[server]
cors_enabled = true
cors_origins = [
  "http://localhost:3000",
  "http://localhost:5173"
]
```

### Wildcard (Not Recommended for Production)

```toml
[server]
cors_enabled = true
cors_origins = ["*"]  # Allow all origins - use only for development
```

## Reverse Proxy (HTTPS)

::: warning Native TLS Not Yet Supported
Raceway does not currently support native TLS/HTTPS. Use a reverse proxy for HTTPS termination.

**Want to contribute?** Native TLS support is a [priority issue for contributors](https://github.com/mode7labs/raceway/issues).
:::

### Production Setup

Run Raceway on localhost and use a reverse proxy:

```toml
[server]
host = "127.0.0.1"  # localhost only
port = 8080
```

### nginx + Let's Encrypt

**Install Certbot:**
```bash
sudo apt install certbot python3-certbot-nginx
```

**Get certificate:**
```bash
sudo certbot certonly --nginx -d raceway.company.com
```

**nginx configuration:**
```nginx
server {
    listen 443 ssl http2;
    server_name raceway.company.com;

    ssl_certificate /etc/letsencrypt/live/raceway.company.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/raceway.company.com/privkey.pem;

    # Modern TLS only
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
    ssl_prefer_server_ciphers off;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000" always;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name raceway.company.com;
    return 301 https://$server_name$request_uri;
}
```

**Reload nginx:**
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Caddy (Automatic HTTPS)

Caddy automatically obtains and renews Let's Encrypt certificates:

**Caddyfile:**
```caddy
raceway.company.com {
    reverse_proxy 127.0.0.1:8080
}
```

**Run Caddy:**
```bash
caddy run --config Caddyfile
```

That's it! Caddy handles certificates automatically.

### Traefik

**docker-compose.yml:**
```yaml
version: '3'

services:
  traefik:
    image: traefik:v2.10
    command:
      - "--providers.docker=true"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.myresolver.acme.tlschallenge=true"
      - "--certificatesresolvers.myresolver.acme.email=admin@company.com"
      - "--certificatesresolvers.myresolver.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock:ro"
      - "./letsencrypt:/letsencrypt"

  raceway:
    image: raceway:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.raceway.rule=Host(`raceway.company.com`)"
      - "traefik.http.routers.raceway.entrypoints=websecure"
      - "traefik.http.routers.raceway.tls.certresolver=myresolver"
```

## Network Security

### Bind to Localhost (Recommended)

```toml
[server]
host = "127.0.0.1"  # Only accessible from localhost
port = 8080
```

Access via reverse proxy only. This prevents direct access to Raceway.

### Firewall Rules

**ufw:**
```bash
# Allow HTTPS
sudo ufw allow 443/tcp

# Allow SSH
sudo ufw allow 22/tcp

# Deny direct access to Raceway port
sudo ufw deny 8080/tcp

sudo ufw enable
```

**iptables:**
```bash
# Allow HTTPS
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# Deny direct access to Raceway
sudo iptables -A INPUT -p tcp --dport 8080 -j DROP
```

## Rate Limiting

### Application-Level

```toml
[server]
rate_limit_enabled = true
rate_limit_rpm = 1000  # requests per minute, globally
```

### Per-IP (nginx)

For per-IP rate limiting, use your reverse proxy:

```nginx
http {
    limit_req_zone $binary_remote_addr zone=raceway:10m rate=100r/m;

    server {
        location / {
            limit_req zone=raceway burst=20 nodelay;
            limit_req_status 429;
            proxy_pass http://127.0.0.1:8080;
        }
    }
}
```

## Database Security

### PostgreSQL

**Require SSL:**

```toml
[storage]
backend = "postgres"

[storage.postgres]
connection_string = "postgresql://user:pass@host:5432/db?sslmode=require"
```

**Use environment variables:**

```bash
export RACEWAY_POSTGRES_CONNECTION="postgresql://..."
```

**Limit permissions:**

```sql
-- Create application user with minimal permissions
CREATE USER raceway_app WITH PASSWORD 'strong-password';
GRANT CONNECT ON DATABASE raceway TO raceway_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO raceway_app;

-- Create read-only user for analytics
CREATE USER raceway_readonly WITH PASSWORD 'another-password';
GRANT CONNECT ON DATABASE raceway TO raceway_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO raceway_readonly;
```

## Secrets Management

### Environment Variables

```bash
# .env file (add to .gitignore!)
RACEWAY_API_KEYS='["key1", "key2"]'
RACEWAY_POSTGRES_CONNECTION="postgresql://..."

# Load in shell
export $(cat .env | xargs)
```

**Never commit `.env` files to version control.**

### AWS Secrets Manager

```bash
# Store secret
aws secretsmanager create-secret \
  --name raceway/api-keys \
  --secret-string '["key1", "key2"]'

# Retrieve in startup script
export RACEWAY_API_KEYS=$(aws secretsmanager get-secret-value \
  --secret-id raceway/api-keys \
  --query SecretString \
  --output text)
```

### Kubernetes Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: raceway-secrets
type: Opaque
stringData:
  api-keys: |
    ["key1", "key2"]
  postgres-connection: "postgresql://..."
---
apiVersion: v1
kind: Pod
metadata:
  name: raceway
spec:
  containers:
  - name: raceway
    image: raceway:latest
    env:
    - name: RACEWAY_API_KEYS
      valueFrom:
        secretKeyRef:
          name: raceway-secrets
          key: api-keys
    - name: RACEWAY_POSTGRES_CONNECTION
      valueFrom:
        secretKeyRef:
          name: raceway-secrets
          key: postgres-connection
```

## Container Security

### Run as Non-Root

**Dockerfile:**

```dockerfile
FROM rust:1.75 AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 raceway
USER raceway
WORKDIR /home/raceway
COPY --from=builder /app/target/release/raceway /usr/local/bin/
CMD ["raceway", "serve"]
```

### Resource Limits

**Docker:**

```bash
docker run \
  --memory=1g \
  --cpus=2 \
  --read-only \
  --tmpfs /tmp \
  raceway:latest
```

**Kubernetes:**

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: raceway
    image: raceway:latest
    resources:
      limits:
        memory: "1Gi"
        cpu: "2"
      requests:
        memory: "512Mi"
        cpu: "1"
    securityContext:
      runAsNonRoot: true
      runAsUser: 1000
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities:
        drop:
        - ALL
```

## Security Checklist

### Deployment

- [ ] Enable API key authentication (`auth_enabled = true`)
- [ ] Use HTTPS via reverse proxy (nginx/Caddy/Traefik)
- [ ] Configure CORS to specific origins only
- [ ] Bind to localhost (`host = "127.0.0.1"`)
- [ ] Enable rate limiting
- [ ] Use strong, randomly generated API keys (64+ chars)
- [ ] Store secrets in secret manager or encrypted env vars
- [ ] Run as non-root user
- [ ] Enable firewall rules
- [ ] Use PostgreSQL with SSL in production

### Monitoring

- [ ] Monitor failed authentication attempts
- [ ] Alert on rate limit hits
- [ ] Track API key usage by key
- [ ] Review access logs regularly
- [ ] Monitor for unusual traffic patterns
- [ ] Set up alerts for anomalies

### Maintenance

- [ ] Rotate API keys every 90 days
- [ ] Renew TLS certificates (automatic with Let's Encrypt)
- [ ] Review and update CORS origins quarterly
- [ ] Apply security patches promptly
- [ ] Run `cargo audit` regularly
- [ ] Keep dependencies updated

## Security Best Practices

### 1. Defense in Depth

Use multiple security layers:
- API keys **AND** network restrictions
- HTTPS **AND** reverse proxy
- Rate limiting **AND** WAF

### 2. Principle of Least Privilege

Grant minimum necessary access:
- Read-only database users for analytics
- Restricted file permissions (640 for configs, 600 for secrets)
- Limited container capabilities
- Separate API keys per service

### 3. Regular Updates

Keep dependencies current:

```bash
# Update Rust dependencies
cargo update

# Check for security advisories
cargo audit

# Scan container images
docker scan raceway:latest
```

### 4. Security Monitoring

Monitor for:
- Failed authentication attempts (>5/min from same IP)
- Unusual traffic patterns (geographic anomalies)
- Resource exhaustion attempts
- SQL injection attempts (if using raw queries)
- Large payloads (potential DoS)

## Compliance

### Data Protection

**GDPR considerations:**
- Implement data retention policies (delete old traces)
- Provide data export capabilities via API
- Support data deletion requests
- Document what data is collected in privacy policy

**HIPAA/SOC 2:**
- Enable audit logging for all access
- Implement role-based access controls (future feature)
- Encrypt data at rest (PostgreSQL encryption)
- Encrypt data in transit (HTTPS via reverse proxy)
- Regular security reviews and penetration testing
- Incident response procedures

## Reporting Security Issues

Found a security vulnerability? Please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email hello@mode7.io with details
3. Include steps to reproduce if possible
4. Allow 90 days for patching before public disclosure

We'll acknowledge receipt within 48 hours and provide a timeline for fixes.

## Next Steps

- [Configuration](/guide/configuration) - Configure security settings
- [Storage](/guide/storage) - Secure database access
- [Getting Started](/guide/getting-started) - Initial setup
