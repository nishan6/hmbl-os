# Design system and app shell

An original, calm interface for dense business work: restrained colour, clear hierarchy, compact tables. It takes cues from Apple's human interface principles (clarity, deference to content, depth through layering) without copying Apple's assets, fonts or components.

## Tokens

All raw values live in `src/app/globals.css`. Components only use the semantic names Tailwind generates from them.

| Group    | Utilities                                                                                                    | Notes                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Surfaces | `bg-bg`, `bg-surface`, `bg-surface-2`, `bg-sunken`, `bg-elevated`, `bg-sidebar`, `bg-hover`, `bg-selected`   | In dark mode surfaces get lighter as they rise                    |
| Text     | `text-text`, `text-secondary`, `text-muted`, `text-disabled`, `text-on-accent`                               | `muted` is the lightest colour allowed for readable text          |
| Lines    | `border-border`, `border-separator`, `border-border-strong`                                                  | Separators for structure, borders for controls                    |
| Accent   | `bg-accent`, `text-accent`, `bg-accent-soft`, `outline-focus`                                                | One brand colour, used for primary actions, selection and focus   |
| Status   | `success`, `warning`, `danger`, `info`, `neutral`, each with `-soft`                                         | Never the only signal; always with an icon or label               |
| Type     | `text-xs` 12, `text-sm` 13, `text-base` 14, `text-md` 16, `text-lg` 20, `text-xl` 24                         | System font stack; `tabular` utility for figures                  |
| Shape    | `rounded-sm` 4, `rounded-md` 6, `rounded-lg` 10; `shadow-sm/md/lg`                                           | Three radii only                                                  |
| Layout   | `w-sidebar`, `h-topbar`, `h-control(-sm/-lg)`, `h-row(-dense)`, `max-w-content`, `max-w-form`, `max-w-prose` | Control height 32px; comfortable table rows 40px, dense 32px      |
| Motion   | `duration-(--duration-fast)`, `ease-(--ease-standard)`                                                       | Short and functional; switched off under `prefers-reduced-motion` |

### Themes

Light is the default under `:root`. Dark applies when the user picks it (`data-theme="dark"` on `<html>`, stored in the `hmbl-theme` cookie and rendered on the server so there is no flash) or when they choose "Match system" and the device is in dark mode. The dark values appear twice in the stylesheet for those two cases; `tests/unit/design-tokens.test.ts` fails if they drift apart.

### Accessibility

The target is WCAG 2.2 AA.

- `tests/unit/design-tokens.test.ts` checks text and status colours against 4.5:1, and the focus ring against 3:1, in both themes.
- `tests/e2e/accessibility.spec.ts` runs axe on the sign-in page and every admin page, in light and dark.
- Every interactive element shows a visible focus ring. The shell has a skip link, landmarks (`banner`, `navigation`, `main`) and one `h1` per page.
- Icon-only buttons require a label (`IconButton`). Form fields come with their label, description and error wired together (`Field`).
- Scrollable tables are keyboard focusable.

## Components

| Component                                                    | File                                          | Use                                                                                             |
| ------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Button`, `IconButton`, `buttonClasses`                      | `components/ui/button.tsx`                    | One primary action per view; secondary for the rest; quiet in toolbars                          |
| `Field`, `Input`, `Select`, `Textarea`                       | `components/ui/field.tsx`                     | Errors appear under the field; submitted values are kept after an error                         |
| `StatusBadge`, `Tag`                                         | `components/ui/status.tsx`                    | Statuses from the spec, each with an icon, a label and a tone                                   |
| `Table`, `THead`, `TBody`, `TR`, `TH`, `TD`                  | `components/ui/table.tsx`                     | `align="right"` for numbers and money; sticky header; horizontal scroll                         |
| `PageHeader`, `Section`, `Panel`, `DetailList`, `EmptyState` | `components/ui/page.tsx`                      | Page structure: hierarchy and spacing first, cards only where they help                         |
| `Alert`, `Skeleton`, `Breadcrumbs`                           | `components/ui/page.tsx`                      | Feedback, loading and wayfinding                                                                |
| `ActionButton`                                               | `components/ui/action-button.tsx`             | One-click server actions (archive, make default) with an inline error and optional confirmation |
| `useForm`, `FormAlert`                                       | `components/ui/use-form.ts`, `form-alert.tsx` | Form state for server actions: keeps values after an error, resets after success                |

Formatting helpers live in `src/lib/format.ts`: `formatMoney` takes integer minor units and an ISO currency code and never goes through floating point; `formatDate` and `formatDateTime` take the entity's time zone.

## App shell

`src/app/(app)/layout.tsx` wraps every signed-in page.

- **Sidebar** (`components/shell/sidebar.tsx`): the information architecture from the spec. The server decides which items the user may see; modules that aren't built yet are shown as "Planned" without a link. Below 1024px it becomes a drawer (`mobile-nav.tsx`).
- **Top bar**: the entity switcher and the account menu. The entity switcher appears when a user can see more than one legal entity and narrows entity-owned lists such as number formats and the audit log; the choice is kept in an http-only cookie and checked against the user's permissions on every request. The account menu holds the theme choice and sign-out.
- **States**: `loading.tsx` shows skeletons, `error.tsx` shows a retry with the error reference only, and `not-found.tsx` is also what users see for records outside their entities.

Hiding a navigation item is never the access control. Each page and service checks permissions on the server; the e2e suite checks that a user without `audit.view` gets "Page not found" at `/admin/audit`.

## Admin screens in this stage

| Path                                | Shows                                                           | Permission                                               |
| ----------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| `/admin/organisation`               | Legal entities, business units, cost centres, locations         | `organisation.view`                                      |
| `/admin/organisation/entities/new`  | Create a legal entity                                           | `organisation.create` for all entities                   |
| `/admin/organisation/entities/[id]` | Entity details, tax registrations, number formats               | `organisation.view` for that entity                      |
| `/crm/clients` and below            | Clients and contacts (see [crm.md](crm.md))                     | `crm.view`                                               |
| `/quotes` and below                 | Quotes and the line editor (see [commercial.md](commercial.md)) | `commercial.view`; editing needs `commercial.edit`       |
| `/print/quotes/[id]`                | The client-facing quote, outside the app shell, always light    | `commercial.view` for that entity                        |
| `/admin/master-data`                | Tax rates, payment terms, units and quote rules                 | `commercial.view`, `finance.view` or `organisation.view` |
| `/admin/numbering`                  | Number formats with an example of the next number               | `organisation.view`                                      |
| `/admin/users`                      | Users, their roles and entity scope                             | `users.view`                                             |
| `/admin/audit`                      | Audit events, filterable by action, newest first                | `audit.view`                                             |

Editing roles, users and numbering schemes from the UI comes later; the services for them exist and are tested.
