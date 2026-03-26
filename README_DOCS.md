# API Documentation

This repository includes two documentation artifacts:

- OpenAPI (Swagger) for REST endpoints — served at `/api/docs` when the backend is running.
- AsyncAPI spec for RabbitMQ events — `asyncapi.yaml` at the repo root.

Quick start

1. Start the backend:

```bash
cd apps/backend
npm run dev
```

2. Open Swagger UI:

- Visit `http://localhost:PORT/api/docs` (PORT is your backend port, default in `.env` or 3001).

Generate AsyncAPI HTML (optional)

If you want HTML docs for the AsyncAPI spec, install the AsyncAPI Generator globally or use npx:

```bash
npx @asyncapi/generator -o docs asyncapi.yaml @asyncapi/html-template
```

This will output static HTML in the `docs/` folder.

Notes

- Controllers include JSDoc `@openapi` blocks to populate the OpenAPI spec.
- Extend or annotate additional controllers/routes with the same `@openapi` blocks to enrich the Swagger UI.
