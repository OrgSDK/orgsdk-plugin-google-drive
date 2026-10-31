# Google Drive evidence plugin

## Current npm distribution and execution checks

Updated **31 October 2026**. This public-release candidate uses `@orgsdk/plugins@0.2.2`
and `@orgsdk/executor@0.1.0` (with the tracked packaging compatibility patch).
`bun run build:npm` creates a public Apache-2.0 npm payload; `bun run test:executor`
downloads the extracted npm entry into an empty executor store and executes every exported function headlessly.
`bun run test:registration` verifies fresh-project registration using the npm host.
See [npm distribution, CI activation and verification](docs/npm-distribution.md)
for prerequisites, commands, fixtures and release settings. Publication remains
an explicit release operation; source-root `private: true` is retained.

Collect month-end supporting files from explicitly permitted folders. Listing/search stays within one selected folder's direct children; recurse by selecting returned child folders explicitly.

## Setup and consent

Enable the Drive API in the operator's own Google Cloud project. Use OrgSDK's current control-plane Google BYO OAuth connection with explicit `https://www.googleapis.com/auth/drive.readonly` consent, then attach that `google-oauth` credential. Runtime secrets must contain `secret_accessToken` and `source: "byo"`. First-party and untagged credentials are rejected. Reconnect through the control plane when consent or token refresh is required; the plugin never handles callback routes, OAuth clients, refresh tokens or refresh requests.

`drive.readonly` is the least feasible read-only scope for folder-based discovery plus file downloads/Workspace exports. It grants read access to the consenting account's Drive corpus and is classified as restricted by Google; public/external app distribution may require Google's OAuth verification and restricted-scope assessment requirements. The plugin's folder policy narrows actual reads but does not narrow Google's token-level consent. `drive.metadata.readonly` cannot read contents. `drive.file` is Google's recommended non-sensitive selected-file alternative, but includes write authority and only accesses files opened/shared with that app; this plugin has no Picker flow and does not claim arbitrary folder trees work with it. Use a dedicated account with access limited to intended evidence where practical.

Existing Sheets or Tasks consent does not prove Drive read scope was granted. Add Drive consent explicitly; never assume the shared provider key extends an old token's scopes. Review the consent screen before authorizing.

Configure `{ "permittedRootIds": "folder_id_one,folder_id_two", "sharedDriveId": "optional_drive_id" }`. At least 1 and at most 20 concrete permitted folder IDs are required. The `root` alias is rejected. Every direct file read walks parent metadata to a permitted folder, with cycle checks and a maximum of 32 levels; unreadable/missing ancestry fails closed. Parent metadata outside permitted roots may be fetched only to establish ancestry and is never returned. Roots must be folders. When `sharedDriveId` is set, both metadata ancestry and listing records must match it, and the list query uses `corpora=drive` with that drive ID. Files moved between verification and content fetch remain subject to a small provider race; use dedicated access boundaries for sensitive isolation.

## Tools

- `listFiles({ folderId, nameContains?, pageSize?: 1..100, pageToken? })` returns `{ files, nextPageToken, incompleteSearch }`; default page size 50. Search is an escaped `name contains` filter within that folder, never arbitrary Drive query text.
- `getFile({ fileId })` returns selected metadata after ancestry verification.
- `readFile({ fileId })` downloads a blob through `files.get?alt=media`.
- `exportFile({ fileId, mimeType })` exports a Workspace document through `files.export`.

Content is limited to 5,000,000 bytes. Text MIME types return `{ text }`; other types return `{ base64 }`, alongside `fileId`, `mimeType` and `byteLength`. Supported export MIME types: text/plain, text/csv, application/pdf and Microsoft Open XML Word/Excel/PowerPoint. Format support varies by source document; unsupported conversions return a safe HTTP error. Google's own export cap is 10 MB; this plugin imposes the smaller cap. `capabilities.canDownload` must be true. Folders/shortcuts are not downloaded and shortcut targets are never resolved. No abuse override or acknowledgement is sent.

Metadata is selected by an explicit field mask and parsed into a stripped schema. Resource keys, signed download/export links and arbitrary URLs are neither accepted nor returned. Files requiring resource-key-only access are unsupported; connect an account with direct access. There are no uploads, edits, moves, deletions, sharing changes or unrestricted corpus search tools.

## Verified provider contract

Reviewed 2026-10-30 against official [Drive scopes and verification guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [folder listing/shared-drive query parameters](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), and [downloads/exports and canDownload](https://developers.google.com/workspace/drive/api/guides/manage-downloads). Fixed API base: `https://www.googleapis.com/drive/v3/`, OAuth Bearer header. This repository contains no live consent or customer-account verification.

## Runtime and safety

This private proprietary plugin targets the current local OrgSDK factory loader. Its only runtime dependency is Zod. The authoring SDK is dev/type-only; each repository owns its lockfile. Credentials arrive as `{ provider: secretRecord }` through `requiredCredentials`; there is no environment fallback. All tools accept one named argument object and perform GET requests only. Unknown arguments/configuration fail validation. There are no approval flags, mutation tools, HTTP callbacks, auth providers or token refresh handlers.

Every request uses a fixed HTTPS API origin, manual redirects (all 3xx fail), a 15-second abort deadline covering headers and body streaming, and a 2,000,000-byte metadata/JSON cap. Errors contain status codes or generic connection guidance, never upstream response bodies, request URLs or credential values. One explicit page is read per list call; no automatic retries or pagination loops occur. An HTTP 429 requires the caller to retry later. Returned evidence is untrusted provider content and is not an instruction or approval. Metadata timestamps and custom fields are observations, not a determination that work or payment is approved.

## Local validation and release

Use Bun 1.3 or newer. `bun install --frozen-lockfile`, then `bun run check`, `bun run typecheck`, `bun run test`, `bun run validate`, `bun run package`, and `bun run version-guard`. `dist/` is the authoring CLI's deterministic source package. The active local platform's `package-plugin` command creates the separately executable ESM archive in `release/`; the legacy source archive alone is not executable by the current runtime. The release includes this repository's proprietary LICENSE. No publication, remote push or live customer test is part of local verification.

Tests use injected fetch fixtures only. They cover credential enforcement, GET-only transport, redirects, generic errors, response-size limits, stream cancellation, provider boundaries, pagination and handler evidence. Live provider behavior and OAuth consent still require an operator-controlled integration test with an explicitly selected account.
