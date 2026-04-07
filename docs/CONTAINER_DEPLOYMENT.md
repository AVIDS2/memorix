# Container Deployment Guide for NAS/HomeServer

This guide helps you deploy Memorix using Docker Compose on your NAS or HomeServer.

## Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/AVIDS2/memorix.git
   cd memorix
   ```

2. **Copy and edit environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your preferred settings
   ```

3. **Start the service**
   ```bash
   docker-compose up -d
   ```

4. **Access the dashboard**
   - Dashboard: http://localhost:3211
   - API: http://localhost:3211/api

## Configuration

### Basic Configuration

Edit `.env` file:

```env
# Service port (default: 3211)
MEMORIX_PORT=3211

# Projects directory (your code repositories)
HOST_PROJECTS_DIR=/path/to/your/projects

# Optional: LLM for embedding/rerank features
MEMORIX_LLM_PROVIDER=openai
MEMORIX_LLM_API_KEY=your-api-key
MEMORIX_LLM_BASE_URL=https://api.openai.com/v1
```

### With Reverse Proxy (Traefik)

For automatic HTTPS and domain routing:

```bash
docker-compose --profile traefik up -d
```

Then access via:
- http://memorix.your-domain.com
- Traefik Dashboard: http://your-server-ip:8080

### Synology NAS

1. Install Docker package from Package Center
2. Enable SSH and connect to your NAS
3. Clone repository to a shared folder (e.g., `/volume1/docker/memorix`)
4. Run:
   ```bash
   cd /volume1/docker/memorix
   sudo docker-compose up -d
   ```

### QNAP NAS

1. Install Container Station
2. Use SSH or Web Terminal
3. Follow Quick Start steps above
4. For persistence, ensure the `memorix-data` volume is on a persistent storage

### Unraid

1. Install Docker Compose Manager plugin
2. Create a new stack with the provided `docker-compose.yml`
3. Add environment variables in the UI
4. Start the stack

### TrueNAS Scale

Use the Docker Compose app:
1. Apps → Available Applications → Docker Compose
2. Upload or paste the `docker-compose.yml`
3. Configure environment variables
4. Deploy

## Data Persistence

Memorix stores all data in the `memorix-data` Docker volume:

- Project configurations
- Observation memories
- Reasoning memories
- Git memories

To backup:
```bash
docker run --rm -v memorix_memorix-data:/data -v $(pwd):/backup alpine tar czf /backup/memorix-backup.tar.gz -C /data .
```

To restore:
```bash
docker run --rm -v memorix_memorix-data:/data -v $(pwd):/backup alpine sh -c "cd /data && tar xzf /backup/memorix-backup.tar.gz"
```

## Updating

```bash
cd /path/to/memorix
docker-compose pull
docker-compose up -d
```

## Troubleshooting

### Port Already in Use

Change `MEMORIX_PORT` in `.env`:
```env
MEMORIX_PORT=3212
```

### Permission Issues

Ensure the container user has read access to your projects directory:
```bash
# On the host
chmod -R 755 /path/to/your/projects
```

### Health Check Failing

Check logs:
```bash
docker-compose logs -f memorix
```

## Advanced: Custom Dockerfile

If you need to customize the build:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Add any custom dependencies here
RUN apk add --no-cache git

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["serve-http", "--host", "0.0.0.0"]
```

Then rebuild:
```bash
docker-compose build --no-cache
docker-compose up -d
```

## Security Considerations

- **Never** expose port 3211 directly to the internet without authentication
- Use a reverse proxy (Traefik, Nginx Proxy Manager) with HTTPS
- Keep your API keys in `.env` file, never commit them
- Regularly update the container image

## Support

- Documentation: https://github.com/AVIDS2/memorix/tree/main/docs
- Issues: https://github.com/AVIDS2/memorix/issues
- Discussions: https://github.com/AVIDS2/memorix/discussions
