# Connector trust dependency map

| Dependency                              | State   | Evidence                                                                                          |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| Generated connector source              | exists  | `packages/core/src/forge.ts` creates reviewable static files.                                     |
| Immutable artifact storage              | missing | No artifact repository or object-store adapter is present.                                        |
| Disposable sandbox/runtime isolation    | missing | `DenySandboxProvider` blocks validation until a provider proves the required isolation.           |
| Scanner, SBOM, license/dependency tools | missing | No scanner adapter or CycloneDX generator is configured.                                          |
| Credential vault                        | missing | Connector generation redacts secrets; no vault interface exists.                                  |
| Durable audit                           | partial | local `EventForgeStore` audit exists; no connector-trust durable repository.                      |
| Owner/MFA authority                     | partial | `AuthContext` has owner and MFA fields; approval gate binds both in core.                         |
| Signing key and rotation history        | partial | external Ed25519 verification/active-revoked state exists; managed key storage/history is absent. |

Production validation, approval persistence, installation, activation, rollback, and execution remain unavailable by design until every critical missing dependency is supplied and independently verified.
