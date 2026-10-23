# Project documents

The **Documents** tab attaches files to a project (spec §17): contracts, client purchase orders, technical files, call sheets, travel documents, deliverables and closeout reports.

Domain code is in `src/server/projects/documents.ts`. The pure rules are in `document-rules.ts`, with unit tests. Storage is in `src/server/storage/files.ts`. The two routes are:

- `POST /api/uploads/projects/[id]/documents` for uploads
- `GET /api/documents/[id]` for downloads

## Storage

The facts about each file are kept in `project_documents`: name, type, size, SHA-256, who uploaded it and when. The bytes are kept on local disk under `STORAGE_DIR` (default `storage/`), at `projects/<project id>/<document id>`. The server builds that path from ids, never from the file name.

A file is written to a `.partial` file first and renamed only when it is complete. If the record can't be saved, the file is removed.

`scripts/backup-db.sh` (`pnpm db:backup`) copies new files into `backups/storage` alongside the database dump. See [running-locally.md](running-locally.md).

## No size limit

Nishan decided on 2026-10-23 that files have no size limit, because event files can be large. To make that safe:

- The browser sends the file as the raw request body, with a real progress bar.
- The route streams it to disk while hashing it, so a large file never sits in memory.
- Server actions are not used for uploads, because they have a body limit.
- The upload path is left out of the proxy matcher (`src/proxy.ts`). The proxy would otherwise buffer the body and cut it off at 10 MB. The route handler checks the session, the permission and the request's origin itself.

## Rules

- **Who:** people with `projects.edit` upload, add new versions and archive, while the project is open. Anyone who can see the project can download.
- **Types:** programs and scripts (`.exe`, `.bat`, `.sh`, `.js`, `.ps1`, `.msi` and similar) are refused. Everything else is accepted. Empty files are refused.
- **Downloads** are always served as attachments with `Content-Security-Policy: sandbox`. Only PDFs and PNG, JPEG, GIF and WebP images can open in the browser (Preview). Their type comes from the file extension, not from what the browser claimed.
- **Versions:** uploading a new version keeps the old file and links the two. The old version is marked as superseded and stays downloadable.
- **Retention:** documents are never deleted. Archiving needs a reason, and the document stays on record. A database trigger refuses deletes and any change other than superseding or archiving, each of which can happen once.
- **Audit:** `document.uploaded` records the size and SHA-256. `document.archived` records the reason.
