# API

Generated from the code by `pnpm api:doc` (apps/server/scripts/api-doc.ts): the endpoints from the shared contract (packages/shared/src/api/contract.ts), and the error codes each route can return from the server's source. A test fails while this file is out of date, so do not edit it by hand.

- Every path starts with `/api/v1`. Path parameters (`:paymentId`) are checked like the request.
- **Who**: the role that can call it with the permissions each role has by default (DOMAIN_RULES §9), and the permission key. "both" means the Super Admin and the Accountant.
- **Request** and **Reply** name the Zod schemas exported from packages/shared. Money is always an integer number of paisa.
- **Errors** are the codes in packages/shared/src/errors.ts. Any request can also get `BAD_REQUEST`, `INTERNAL_ERROR`, `NOT_FOUND` (a body that is not JSON, a fault on Computer 1, an unknown address).

| Method | Path | Who | Request | Reply | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/health` | anyone, no sign-in | — | `healthResponseSchema` | — |
| POST | `/connection-requests` | a computer on the office network, no sign-in | body `connectionRequestCreateSchema` | `connectionRequestResponseSchema` | CONNECTION_REQUESTS_FULL, NOT_ON_LOCAL_NETWORK, VALIDATION_FAILED |
| POST | `/auth/login` | an allowed computer, before sign-in | body `loginRequestSchema` | `loginResponseSchema` | ACCOUNT_INACTIVE, ACCOUNT_LOCKED, NOT_ALLOWED, VALIDATION_FAILED, WRONG_USERNAME_OR_PASSWORD |
| GET | `/auth/session` | both | — | `sessionSchema` | NOT_ALLOWED, NOT_SIGNED_IN, SESSION_EXPIRED |
| POST | `/auth/logout` | both | — | nothing | NOT_ALLOWED, NOT_SIGNED_IN, SESSION_EXPIRED |
| GET | `/connection-requests` | Super Admin (`settings.manage`) | — | `connectionsResponseSchema` | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED |
| POST | `/connection-requests/:requestId/allow` | Super Admin (`settings.manage`) | — | `allowedComputerSchema` | NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, REQUEST_NOT_PENDING, SESSION_EXPIRED, VALIDATION_FAILED |
| POST | `/connection-requests/:requestId/decline` | Super Admin (`settings.manage`) | — | nothing | NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, REQUEST_NOT_PENDING, SESSION_EXPIRED, VALIDATION_FAILED |
| POST | `/allowed-computers` | Super Admin (`settings.manage`) | body `allowedComputerCreateSchema` | `allowedComputerSchema` | ALREADY_ALLOWED, ALWAYS_ALLOWED, NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| POST | `/allowed-computers/:computerId/remove` | Super Admin (`settings.manage`) | — | nothing | ALREADY_REMOVED, NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| GET | `/school` | an allowed computer; more once signed in | — | `schoolResponseSchema` | NOT_ALLOWED |
| GET | `/classes` | both | — | `classesResponseSchema` | NOT_ALLOWED, NOT_SIGNED_IN, SESSION_EXPIRED |
| GET | `/dashboard/finance` | both (`dashboard.finance`) | — | `financeDashboardSchema` | ACCOUNT_NOT_SET_UP, NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED |
| GET | `/dashboard/school` | Super Admin (`dashboard.school`) | — | `schoolDashboardSchema` | ACCOUNT_NOT_SET_UP, NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED |
| GET | `/students` | both (`students.view`) | query `studentSearchQuerySchema` | `studentSearchResponseSchema` | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| GET | `/students/:studentId/fees` | both (`students.view`) | — | `studentFeesSchema` | NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| GET | `/students/:studentId/dues` | both (`fees.collect`) | — | `studentDuesResponseSchema` | NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| POST | `/payments` | both (`fees.collect`) | body `collectPaymentRequestSchema` | `collectPaymentResponseSchema` | ACCOUNT_NOT_SET_UP, AMOUNT_EXCEEDS_DUE, DUE_ALREADY_PAID, DUE_NOT_OWED, NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, SCHOOL_NOT_SET_UP, SESSION_EXPIRED, STUDENT_NOT_IN_CLASS, VALIDATION_FAILED |
| POST | `/payments/:paymentId/print` | both (`fees.collect`) | — | PDF | ALREADY_PRINTED, NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| POST | `/payments/:paymentId/reprint` | both (`payments.reprint`) | — | PDF | NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, ORIGINAL_NOT_PRINTED, SESSION_EXPIRED, VALIDATION_FAILED |
| GET | `/receipts/test` | both (`fees.collect`) | — | PDF | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SCHOOL_NOT_SET_UP, SESSION_EXPIRED |
| GET | `/payments` | both (`payments.view`) | query `paymentsListQuerySchema` | `paymentsListResponseSchema` | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| GET | `/payments/:paymentId` | both (`payments.view`) | — | `receiptSchema` | NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| POST | `/void-requests` | both (`payments.requestVoid`) | body `voidRequestCreateSchema` | `voidRequestSchema` | ALREADY_VOIDED, NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED, VOID_ALREADY_REQUESTED |
| GET | `/void-requests` | both (`payments.requestVoid`) | — | `voidRequestsResponseSchema` | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED |
| GET | `/void-requests/pending` | Super Admin (`payments.void`) | — | `voidRequestsResponseSchema` | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED |
| POST | `/voids` | Super Admin (`payments.void`) | body `voidRequestCreateSchema` | `voidRequestSchema` | ALREADY_VOIDED, INSUFFICIENT_CASH, NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED, VOID_REQUEST_WAITING |
| POST | `/void-requests/:requestId/approve` | Super Admin (`payments.void`) | body `voidApprovalSchema` | `voidRequestSchema` | ALREADY_VOIDED, INSUFFICIENT_CASH, NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, OWN_VOID_REQUEST, REQUEST_NOT_PENDING, SESSION_EXPIRED, VALIDATION_FAILED |
| POST | `/void-requests/:requestId/decline` | Super Admin (`payments.void`) | body `voidDeclineSchema` | `voidRequestSchema` | NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, REQUEST_NOT_PENDING, SESSION_EXPIRED, VALIDATION_FAILED |
| POST | `/payments/:paymentId/allow-original` | Super Admin (`payments.void`) | body `originalPrintAllowanceSchema` | nothing | NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, ORIGINAL_ALREADY_ALLOWED, ORIGINAL_NOT_PRINTED, SESSION_EXPIRED, VALIDATION_FAILED |
| GET | `/expense-categories` | both (`accounts.view`) | — | `categoriesResponseSchema` | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED |
| GET | `/income-categories` | both (`accounts.view`) | — | `categoriesResponseSchema` | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED |
| GET | `/expenses` | both (`accounts.view`) | query `moneyEntryListQuerySchema` | `moneyEntryListResponseSchema` | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| POST | `/expenses` | both (`expense.create`) | body `moneyEntryCreateSchema` | `moneyEntrySchema` | CATEGORY_INACTIVE, INSUFFICIENT_CASH, NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| GET | `/incomes` | both (`accounts.view`) | query `moneyEntryListQuerySchema` | `moneyEntryListResponseSchema` | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| POST | `/incomes` | both (`income.create`) | body `moneyEntryCreateSchema` | `moneyEntrySchema` | CATEGORY_INACTIVE, INSUFFICIENT_CASH, NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| GET | `/accounts` | both (`accounts.view`) | — | `accountsResponseSchema` | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED |
| GET | `/accounts/:accountId/book` | both (`accounts.view`) | query `bookQuerySchema` | `bookResponseSchema` | NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| POST | `/transfers` | both (`accounts.transfer`) | body `transferCreateSchema` | `transferSchema` | INSUFFICIENT_CASH, NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| GET | `/day-closes/:date` | both (`accounts.dayClose`) | — | `dayCloseStatusSchema` | ACCOUNT_NOT_SET_UP, NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| POST | `/day-closes` | both (`accounts.dayClose`) | body `dayCloseCreateSchema` | `dayCloseSchema` | ACCOUNT_NOT_SET_UP, CASH_BELOW_ZERO, DAY_ALREADY_CLOSED, NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, SCHOOL_NOT_SET_UP, SESSION_EXPIRED, VALIDATION_FAILED |
| GET | `/day-closes` | both (`accounts.dayClose`) | — | `dayClosesResponseSchema` | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED |
| POST | `/day-closes/:date/print` | both (`accounts.dayClose`) | — | PDF | NOT_ALLOWED, NOT_FOUND, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
| GET | `/reports` | both (`reports.finance`) | query `reportQuerySchema` | `reportSchema` | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SCHOOL_NOT_SET_UP, SESSION_EXPIRED, VALIDATION_FAILED |
| GET | `/reports/pdf` | both (`reports.finance`) | query `reportQuerySchema` | PDF | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SCHOOL_NOT_SET_UP, SESSION_EXPIRED, VALIDATION_FAILED |
| GET | `/reports/xlsx` | both (`reports.finance`) | query `reportQuerySchema` | Excel workbook | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SCHOOL_NOT_SET_UP, SESSION_EXPIRED, VALIDATION_FAILED |
| GET | `/attendance/summary` | both (`attendance.view`) | query `attendanceSummaryQuerySchema` | `attendanceSummarySchema` | NOT_ALLOWED, NOT_SIGNED_IN, NO_PERMISSION, SESSION_EXPIRED, VALIDATION_FAILED |
