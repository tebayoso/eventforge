# Deployment

For local infrastructure, use Docker Compose. It starts PostgreSQL with pgvector and MinIO; the application is enabled with `docker compose --profile app up --build`.

For Kubernetes, create two secrets first:

```bash
kubectl create secret generic eventforge-postgres --from-literal=database-url='postgres://…'
kubectl create secret generic eventforge-runtime \
  --from-literal=openai-api-key="$OPENAI_API_KEY" \
  --from-literal=master-key="$(openssl rand -base64 48)"
helm upgrade --install eventforge ./deploy/helm/eventforge
```

Provider webhook/OAuth secrets belong in the runtime secret and must be configured separately. Deploy the dashboard as static assets or inside the Electron companion; it communicates with the control plane over its public HTTPS endpoint.
