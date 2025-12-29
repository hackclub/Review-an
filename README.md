# dinopoll

> A friendly polling app for the [Hack Club](https://hackclub.com) Slack!

![screenshot](img/screenshot.png)

## cool features:

- costs $0, and there are no limits (unlike _cough cough_ Polly and Simple Poll) 🚀
- anonymous polling 🙈
- open polling where anyone can add options 📋
- ~~workflow step for automating poll creation 🤖~~ (feature temporarily removed)

## API Usage

### Create a Poll

**Windows (CMD):**
```cmd
curl -X POST http://localhost:2345/create -H "Content-Type: application/json" -d "{\"title\": \"What should we have for lunch?\", \"options\": [\"Pizza\", \"Tacos\", \"Sushi\"], \"channel\": \"C1234567890\"}"
```

**macOS/Linux:**
```bash
curl -X POST http://localhost:2345/create \
  -H "Content-Type: application/json" \
  -d '{"title": "What should we have for lunch?", "options": ["Pizza", "Tacos", "Sushi"], "channel": "C1234567890"}'
```

### Toggle a Poll (Open/Close)

```bash
curl -X POST http://localhost:2345/toggle/1
```

### Get Poll Status

```bash
curl http://localhost:2345/poll/1
```

### Request Body Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | The poll question |
| `options` | string[] | Yes | Array of poll options |
| `channel` | string | Yes | Slack channel ID (e.g., `C1234567890`) |
| `multipleVotes` | boolean | No | Allow multiple votes per user (default: false) |
| `anonymous` | boolean | No | Hide voter names (default: false) |
| `othersCanAdd` | boolean | No | Allow others to add options (default: false) |

## Development

### Prerequisites

- Docker & Docker Compose
- Node.js (for local development without Docker)

### Environment Variables

```
SLACK_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
DATABASE_URL=postgres://postgres:postgres@db:5432/dinopoll
```

### Running with Docker (recommended)

```bash
# Start all services (app, database, pgweb)
docker-compose -f docker-compose.dev.yml up -d

# View logs
docker-compose -f docker-compose.dev.yml logs -f

# Stop services
docker-compose -f docker-compose.dev.yml down
```

- **API**: http://localhost:2345
- **PgWeb (DB viewer)**: http://localhost:3002

### Running locally

```bash
# Install dependencies
npm install

# Run database migrations
npx prisma migrate dev

# Start development server
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## Deployment (Coolify)

### Environment Variables

Set these in Coolify:

| Variable | Description |
|----------|-------------|
| `SLACK_TOKEN` | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | From Slack app "Basic Information" |
| `DATABASE_URL` | PostgreSQL connection string |

### Slack App Configuration

Set the **Interactivity Request URL** to:
```
https://your-coolify-domain.com/slack/events
```

### Health Check

```
GET /health
```
