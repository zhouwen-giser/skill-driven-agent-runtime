# ADR-065: PostgreSQL MCP Management Operation Audit

## Status

Accepted on 2026-07-13.

## Context

FR-ADM-002 requires complete MCP Server lifecycle operations and operation logs. Tool invocation audit is not sufficient evidence for administrator registration, discovery refresh, remote health checks, credential rotation, Tool metadata edits, or deletion. V1 has no authenticated identity, while PostgreSQL must remain the system of record.

## Decision

- Define `McpManagementOperation` as a domain-owned immutable evidence record.
- Persist successful MCP management operations in PostgreSQL through the existing `McpRegistryRepository` port.
- Use the explicit actor `anonymous-management`, matching the accepted no-auth V1 baseline rather than inventing an identity model.
- Record only credential-safe summaries. Credential rotation stores sorted header names, never values, ciphertext, or decrypted secrets.
- Preserve operation records after MCP Server deletion; the audit table therefore does not use a cascading foreign key to the current registry row.
- Expose read-only operation history through the management API and operational console.

## Consequences

MCP lifecycle changes become replayable operational evidence without making the console or Redis a source of truth. Audit persistence errors remain visible rather than swallowed. V1 records successful operations; a later failure-attempt audit would require an explicit requirement and failure taxonomy.

