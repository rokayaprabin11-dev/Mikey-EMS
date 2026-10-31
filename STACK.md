# Recommended Technology Stack

## School Financial Management & Biometric Attendance System

This is the proposed production technology stack for a two-computer Windows desktop application.

## 1. Complete technology stack

| Layer                 | Technology                          | Purpose                         |
| --------------------- | ------------------------------------ | -------------------------------- |
| Desktop framework     | Electron                            | Windows desktop application     |
| Frontend              | React                               | User interface                  |
| Language              | TypeScript                          | Type-safe development           |
| Build tool            | Vite                                | Fast development and builds     |
| Styling               | Tailwind CSS                        | UI styling                      |
| UI components         | shadcn/ui                           | Reusable interface components   |
| Icons                 | Lucide React                        | Application icons               |
| Routing               | React Router                        | Page navigation                 |
| API state             | TanStack Query                      | API data fetching and caching   |
| Forms                 | React Hook Form                     | Form management                 |
| Validation            | Zod                                 | Input validation                |
| Tables                | TanStack Table                      | Student and financial tables    |
| Charts                | Recharts                            | Dashboard analytics             |
| Backend               | Node.js                             | Server-side runtime             |
| Backend framework     | Fastify                             | REST API                        |
| Database              | PostgreSQL                          | Central school database         |
| ORM                   | Prisma                              | Database queries and migrations |
| Authentication        | Argon2id + session/token management | Secure login                    |
| PDF generation        | PDFKit                              | Receipts and reports            |
| Excel generation      | ExcelJS                             | Excel exports                   |
| Biometric integration | Vendor SDK/API + Node.js adapters   | Fingerprint attendance          |
| Backup storage        | Cloudflare R2                       | Encrypted off-site backups      |
| Backup encryption     | AES-256-GCM                         | Backup confidentiality          |
| Cloud SDK             | AWS SDK for JavaScript v3           | R2 communication                |
| Desktop packaging     | electron-builder                    | Windows installer               |
| Testing               | Vitest                              | Unit and integration testing    |
| Version control       | Git + GitHub                        | Source control                  |
| Package manager       | pnpm                                | Dependency management           |

## 2. Architecture

Computer 1 — Super Admin + Central Server

- Electron + React + TypeScript — Super Admin desktop interface
- Node.js + Fastify — Authentication, permissions, business logic and REST API
- PostgreSQL + Prisma — Central database

Computer 2 — Accountant

- Electron + React — Accountant desktop interface with restricted permissions
- Local LAN API connection — Computer 2 accesses the central backend on Computer 1

Biometric device

- Device-specific integration with Computer 1

Cloudflare R2

- Encrypted backup uploads when internet is available

## 3. Recommended backend architecture

Use a modular monolith rather than microservices.

Organize the backend by business domain:

```
server/
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── students/
│   │   ├── staff/
│   │   ├── fees/
│   │   ├── payments/
│   │   ├── accounting/
│   │   ├── attendance/
│   │   ├── biometric/
│   │   ├── reports/
│   │   ├── backups/
│   │   └── audit/
│   │
│   ├── plugins/
│   ├── middleware/
│   ├── lib/
│   └── index.ts
│
└── prisma/
    ├── schema.prisma
    └── migrations/
```

This keeps the code maintainable without the complexity of multiple independent backend services.

## 4. Important technical decisions

**Why PostgreSQL instead of SQLite?**
Because two computers will access the same database simultaneously. PostgreSQL provides proper centralized database concurrency and transaction management.

**Why Electron?**
It allows building a Windows desktop application using React and web technologies.

**Why Fastify?**
It provides a lightweight backend for handling student records, payments, accounting, authentication, and attendance.

**Why Prisma?**
It provides structured database access, migrations, and TypeScript integration.

**Why modular biometric integration?**
Different manufacturers use different SDKs and protocols. Device-specific adapters allow normalizing attendance events into one application format.

**Why Cloudflare R2?**
It provides object storage for encrypted backups without requiring a VPS or cloud-hosted live database.

## 5. Final recommendation

Recommended stack:
- Electron + React + TypeScript
- Node.js + Fastify
- PostgreSQL + Prisma
- Cloudflare R2

Development machine: Fedora Linux
Production computers: Windows 10/11, subject to compatibility testing.
Communication: REST API over LAN.
Database location: Computer 1 only.

One important implementation rule: keep financial operations inside database transactions, use server-side permission checks, maintain immutable financial audit history, and never let Computer 2 access PostgreSQL directly.

This stack is sufficient for 700 students, 50 staff, and two simultaneous workstations. No microservices, Kubernetes, VPS hosting, or cloud database are needed for this project.
