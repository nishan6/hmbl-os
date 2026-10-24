# Documents

Files attached to the business records they support (spec §17): contracts and signed agreements, quotations, client and vendor purchase orders, invoices, receipts, expense evidence, technical files, call sheets, equipment checklists, travel documents, deliverables, compliance certificates, identity documents and closeout reports.

Every record page that can hold documents has a **Documents** section: projects (its own tab), clients, quotations, vendors (on both the Procurement and Finance vendor pages), purchase orders, vendor bills, sales invoices, crew members, equipment items, trips and logistics movements. **Documents** in the navigation is the library: every current document the viewer may see, filtered by category, record type or search, with archived documents behind a checkbox. Expense receipts keep their own store on the claim ([expenses.md](expenses.md)).

Domain code is in `src/server/documents/`: `records.ts` knows each record type (how to find it, who may see and change it, where its page is) and `documents.ts` lists, uploads, opens and archives. The pure rules (categories, file types, retention) are in `src/server/projects/document-rules.ts`, with unit tests. Storage is in `src/server/storage/files.ts`. The two routes are:

- `POST /api/uploads/documents?recordType=…&recordId=…` for uploads
- `GET /api/documents/[id]` for downloads

## Who sees what

A document belongs to one record (`recordType`, `recordId`) and carries the record's legal entity, or none for records shared across entities (clients, vendors, crew, equipment).

- **Seeing** a record's documents needs `documents.view` and permission to see the record (for example `finance.view` for a vendor bill, `procurement.view` or `finance.view` for a vendor), checked against the record's legal entity. Anyone else gets "not found", in lists, the library and downloads alike.
- **Uploading** and adding a new version need `documents.create` and permission to change the record (for example `projects.edit`, `crm.edit`, `finance.edit`). A closed or cancelled project takes no new documents.
- **Archiving** needs `documents.edit` and permission to change the record.
- **Restricted** documents also need `documents.view_sensitive` (the Owner by default) to see, download or upload. Identity documents are always restricted; any other document can be marked restricted when uploaded. Others see how many restricted documents are hidden, never their names, and the audit log leaves out a restricted document's title and file name.

## Storage

The facts about each file are kept in `documents`: the record, name, category, access, type, size, SHA-256, retention date, who uploaded it and when. The bytes are kept on local disk under `STORAGE_DIR` (default `storage/`), at `projects/<project id>/<document id>` for project documents and `documents/<record id>/<document id>` for the rest. The server builds that path from ids, never from the file name.

A file is written to a `.partial` file first and renamed only when it is complete. If the record can't be saved, the file is removed.

`scripts/backup-db.sh` (`pnpm db:backup`) copies new files into `backups/storage` alongside the database dump. See [running-locally.md](running-locally.md).

## No size limit

Nishan decided on 2026-10-23 that files have no size limit, because event files can be large. To make that safe:

- The browser sends the file as the raw request body, with a real progress bar.
- The route streams it to disk while hashing it, so a large file never sits in memory.
- Server actions are not used for uploads, because they have a body limit.
- The upload path is left out of the proxy matcher (`src/proxy.ts`). The proxy would otherwise buffer the body and cut it off at 10 MB. The route handler checks the session, the permission and the request's origin itself.

## Rules

- **Types:** programs and scripts (`.exe`, `.bat`, `.sh`, `.js`, `.ps1`, `.msi` and similar) are refused. Everything else is accepted. Empty files are refused.
- **Downloads** are always served as attachments with `Content-Security-Policy: sandbox`. Only PDFs and PNG, JPEG, GIF and WebP images can open in the browser (Preview). Their type comes from the file extension, not from what the browser claimed.
- **Versions:** uploading a new version keeps the old file and links the two. The old version is marked as superseded and stays downloadable.
- **Retention:** contracts, signed agreements, client and vendor purchase orders, invoices, receipts and expense evidence are kept at least to the end of the eighth financial year after upload (Companies Act 2013, s.128), shown as "Keep until" (default, not yet confirmed; see [decisions.md](decisions.md)). Documents are never deleted. Archiving needs a reason, and the document stays on record. A database trigger refuses deletes and any change other than superseding or archiving, each of which can happen once.
- **Audit:** `document.uploaded` records the category, access, version, size and SHA-256, against the record. `document.archived` records the reason and the retention date.
