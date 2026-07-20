# Auth.md — EventForge authentication

EventForge's public product documentation and discovery resources are available without credentials. The hosted console and operational API require an authenticated, workspace-scoped identity before they expose tenant data or allow mutations.

## Agent registration

Use the hosted OAuth 2.1 discovery metadata at https://eventforge.dev/.well-known/openid-configuration when OAuth access is enabled for your workspace. For local development, use the credential-free MCP launcher documented in the [configuration guide](https://github.com/tebayoso/eventforge/blob/main/workfiles/CONFIGURATION.md).

The machine-readable registration contract is:

```yaml
agent_auth:
  register_uri: https://api.eventforge.dev/oauth/register
  identity_types: [user, service]
  credential_types: [oauth2-bearer, api-key]
  claims: [sub, workspace_id, scopes]
  revocation_uri: https://api.eventforge.dev/oauth/revoke
```

## Safety boundary

The public webhook ingress accepts only provider-signed events. Console routes remain sign-in gated, and reaction operations require scoped authorization and approval according to the workspace policy.
