# User guide

How to do the everyday work in HMBL OS, for the people who use it. Each section names where to go in the menu and links to the detailed page for the rules behind it. What you see depends on your role: if a menu item or button described here is missing, your role doesn't include it. Ask an administrator.

## Signing in

- Go to the address you were given (on HMBL's computer, <http://localhost:3000>) and sign in with your email and password.
- **Your first time**: you get a link from an administrator. Open it, type the email address it was made for, and choose a password of at least 12 characters.
- **Two-factor**: owners, administrators and finance must use an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and similar). The first time, HMBL OS walks you through it and gives you ten backup codes: keep them somewhere safe. Anyone else can turn it on under **Account menu → Sign-in security**.
- **Forgot your password or lost your phone?** Ask an administrator for a password link. It works once, for 24 hours.
- **Change your password**: Account menu → **Sign-in security**. You'll be signed out on your other devices.
- Sessions last 12 hours. Signing out is in the account menu, top right.

## Finding your way

- **Home** shows what needs you: approvals waiting, your projects, reminders.
- **Approvals** lists everything waiting for your decision: quotes, purchase orders, bills, expense claims and trips.
- The bell shows notifications; **Notifications → Settings** chooses which reach you.
- The **entity switcher** at the top limits lists and reports to one legal entity, or shows all you can see.
- Every list has search and filters; numbers in tables line up so they can be compared at a glance. Light and dark themes are in the account menu.

## Winning work: clients, enquiries and quotes

1. **CRM → Clients → New client**: name, legal name, tax ID and address. HMBL OS warns you about likely duplicates. ([crm.md](crm.md))
2. **CRM → New opportunity** for an enquiry; move it along the pipeline board as it progresses, and log calls and meetings on it.
3. From the opportunity, **New quote**. Add lines with cost and price; totals, margin and markup update as you type. Choose the pricing method per line and add contingency where needed. ([commercial.md](commercial.md))
4. When it is ready: **Submit for approval** if your quote rules need a director's approval, otherwise **Mark as issued**. **Print or save as PDF** gives the client-facing quote, which never shows cost or margin.
5. Record the client's answer under **Next step**. Accepted needs the date, who accepted and how (and their PO number if required). **Accepting creates the project** with the quote's budget and billing milestones.
6. To change a quote after it is approved or issued, **Create a revision**. Earlier versions are kept.

## Running projects

- **Projects** lists projects; open one for its overview, budget, schedule, resources, documents and closeout. ([projects.md](projects.md))
- **Budget**: the original budget comes from the quote. Committed and actual costs arrive from purchase orders, bills, expenses and crew; the forecast shows where the project will land. ([budget.md](budget.md))
- **Changes**: once a project is approved its original budget is fixed; extra scope or cost goes through a change order, which updates the budget when approved. ([change-control.md](change-control.md))
- **Schedule**: phases and milestones; billing milestones show what Finance can invoice. ([schedule.md](schedule.md))
- **Resources**: say what crew and equipment the project needs, then book named people and items. Clashes are shown; confirming over a hard clash needs a reason. ([resources.md](resources.md), [crew.md](crew.md), [equipment.md](equipment.md))
- **Procurement → New** for anything bought or hired from a vendor, against a budget line. It goes for approval, then to the vendor; receive goods against it. ([procurement.md](procurement.md))
- **Travel & Logistics** for trips (travellers, flights, hotels) and shipments of equipment. ([travel.md](travel.md), [logistics.md](logistics.md))
- **Closeout**: the checklist shows what must be finished before the project can close: crew settled, equipment returned, vendor bills received, and the rest. ([closeout.md](closeout.md))

## Show day

- **Production** → the show: venue and times, the running order, call sheets, equipment, travel and movements, contacts, checklists, notes and incidents, on one screen. ([production.md](production.md))
- At a venue with poor signal, use the **field app** (Production → "Field app (works offline)"). Open it once while connected; it keeps your shows from yesterday to two weeks ahead on the device. Checklist ticks, notes, status updates and incidents made offline are sent when you're back online. It shows when you are offline and what is waiting to send. ([offline.md](offline.md))

## Money

Finance roles only, unless stated.

- **Invoices**: Finance → Invoices → New, for a client and optionally a project milestone. Proforma, commercial and tax invoices share one numbering. Issuing numbers and posts it; corrections are by credit note, never by editing. ([invoicing.md](invoicing.md))
- **Receipts**: record money received and allocate it to invoices. A bounced payment is voided, not deleted. ([receipts.md](receipts.md))
- **Bills and payments**: enter the vendor's bill (from a purchase order where there is one), submit it for approval, then record the payment with TDS. ([payables.md](payables.md))
- **Expenses** (everyone with the permission): **Expenses → New**, with a photo of each receipt, then submit. Advances are requested and settled in the same place. ([expenses.md](expenses.md))
- **Bank**: import the bank statement CSV and match lines to receipts and payments. ([banking.md](banking.md))
- **Reports**: receivables and payables ageing, trial balance, profit and loss, balance sheet, cash flow, tax summary, project profitability and the day book, each downloadable as CSV. ([financial-reports.md](financial-reports.md))
- **Period close**: at month end, clear the checklist and close the month; nothing can be posted into it afterwards. ([period-close.md](period-close.md))

## Documents

Attach files to the record they belong to (a project, quote, bill, crew member). The **Documents** library finds them across records. Files are never deleted, only archived, and each new version keeps the old one. You see a record's documents only if you can see the record; restricted ones, such as identity documents, need extra permission. ([documents.md](documents.md))

## People outside HMBL

Clients, vendors and freelancers can have their own portal sign-in. They see only what is shared with them. Invite them from the client's, vendor's or crew member's page under **Portal access**. ([portal.md](portal.md), [client-portal.md](client-portal.md), [vendor-portal.md](vendor-portal.md))

## Administration

Owners and administrators.

- **Users**: invite people with a role, grant and remove roles, make password links, and disable someone who has left (they are signed out at once). ([auth-and-permissions.md](auth-and-permissions.md))
- **Organisation**: legal entities, tax registrations, business units and departments. ([organisation.md](organisation.md))
- **Master data, Numbering**: tax rates, payment terms, units, quote rules, and how documents are numbered. ([master-data.md](master-data.md), [numbering.md](numbering.md))
- **Imports**: bring in clients, vendors, contacts, crew and equipment from spreadsheets, with a preview before anything is saved. Opening balances are in Finance. ([imports.md](imports.md), [migration.md](migration.md))
- **Readiness**: run the production checks and see restore checks and server errors. ([readiness.md](readiness.md))
- **Audit log**: every recorded change, newest first. Nothing in it can be changed or deleted. ([audit-log.md](audit-log.md))

## If something goes wrong

- A message on a form says what to fix; nothing was saved.
- "Page not found" can mean the record doesn't exist or your role can't see it.
- "Something went wrong" is recorded for the administrators under **Administration → Readiness → Server errors**. Tell them what you were doing and when.
