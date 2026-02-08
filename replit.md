# AgentReach FLOW 2.0

Client portal and CRM for managing real estate email newsletters.

## Overview

AgentReach FLOW is a newsletter production system for real estate agents that enables:
- AI-powered email generation via Gemini AI (MJML-based, rendered to HTML)
- Simple HTML paste/preview workflow - import HTML from any email builder
- Click-to-edit HTML preview with inline editing capability
- Client review workflow with tokenized links
- Automatic sender verification via Postmark
- Version history tracking with restore capability
- Status pipeline (7 stages from not_started to sent) - editable via dropdown
- Client feedback comments with timestamps
- Subscription auto-queue: Create newsletters automatically based on client subscription frequency
- Internal notes (team-only, not visible to clients)
- Invoice tracking linked to subscriptions and newsletters

## Architecture

### Frontend (React + TypeScript)
- **Top-Level Navigation** via TopNav component:
  - Dashboard (`/`) - Client overview with Grid/List/Calendar toggle
  - Newsletters (`/newsletters`) - Kanban board or table view with status columns
  - Clients (`/clients`) - Client list with Active/Churned/All filters
  - Invoices (`/invoices`) - Invoice table with side preview
- **Client Profile** (`/clients/:id`) - 3-column layout:
  - Left (256px): Client info + campaigns list
  - Center: HTML preview with click-to-edit capability
  - Right (224px): Status badge + version history + internal notes
- **Routing**: Wouter for client-side routing
- **State**: TanStack Query for server state, React context for auth
- **Styling**: Tailwind CSS with shadcn/ui components
- **Design**: Japanese minimalism with Inter font, forest green accent (#1a5f4a)

### Backend (Express + TypeScript)
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Session-based with express-session
- **Email**: Postmark for sender signatures and verification

## Key Files

### Schema & Types
- `shared/schema.ts` - Drizzle schemas and TypeScript types
  - Users, Clients, BrandingKits, Newsletters, NewsletterVersions
  - ReviewTokens for client review links
  - Simple NewsletterDocument: { html: string }

### Backend
- `server/routes.ts` - All API endpoints
- `server/storage.ts` - DatabaseStorage class for data access
- `server/ai-service.ts` - Optional AI HTML editing (OpenAI-based, legacy)
- `server/gemini-email-service.ts` - Gemini AI email generation (MJML-based)
- `server/mjml-service.ts` - MJML rendering and validation
- `server/email-compiler.ts` - Returns raw HTML from document
- `server/postmark-service.ts` - Postmark sender signature management

### Frontend
- `client/src/App.tsx` - Root component with auth and routing
- `client/src/pages/master-dashboard.tsx` - Client grid view (home page)
- `client/src/pages/client-profile.tsx` - 3-column client workspace
- `client/src/pages/login.tsx` - Login/register page
- `client/src/pages/review.tsx` - Client review page (tokenized)
- `client/src/pages/newsletters.tsx` - Newsletter Kanban board and table view
- `client/src/pages/clients-list.tsx` - Clients list with filters
- `client/src/pages/invoices.tsx` - Invoice table with side preview
- `client/src/components/TopNav.tsx` - Top-level navigation tabs
- `client/src/components/HTMLPreviewFrame.tsx` - Click-to-edit HTML preview
- `client/src/components/RightPanel.tsx` - Version history + status + internal notes
- `client/src/components/CreateNewsletterDialog.tsx` - New campaign with HTML import + auto-suggest date

## Database Schema

### Core Tables
- `users` - Producer accounts (email, name, role)
- `clients` - Client profiles (name, email, location, status, newsletterFrequency)
- `branding_kits` - Brand preferences for each client
- `html_templates` - Base HTML templates for newsletters
- `subscriptions` - Client subscription plans with frequency (weekly, biweekly, monthly)
- `newsletters` - Newsletter instances (title, period, status, documentJson, internalNotes, subscriptionId)
- `newsletter_versions` - Version snapshots
- `invoices` - Payment records linked to clients, subscriptions, and newsletters
- `review_tokens` - Secure client review links

## Newsletter Status Pipeline

7 stages:
1. `not_started` - New campaign created
2. `in_progress` - Being edited
3. `internal_review` - Ready for team review
4. `client_review` - Sent to client
5. `revisions` - Client requested changes
6. `approved` - Client approved
7. `sent` - Newsletter delivered

## API Endpoints

### Auth
- `POST /api/auth/register` - Register new producer
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout

### Clients
- `GET /api/clients` - List all clients
- `POST /api/clients` - Create client
- `GET /api/clients/:id` - Get client with branding kit
- `PATCH /api/clients/:id` - Update client

### Newsletters
- `GET /api/clients/:clientId/newsletters` - List newsletters
- `POST /api/clients/:clientId/newsletters` - Create newsletter (with optional HTML import)
- `GET /api/newsletters/:id` - Get newsletter with versions
- `PATCH /api/newsletters/:id` - Update newsletter (status, html)
- `POST /api/newsletters/:id/ai-command` - AI HTML editing (OpenAI, legacy)
- `POST /api/newsletters/:id/ai-generate` - AI email generation from prompt (Gemini + MJML)
- `POST /api/newsletters/:id/ai-edit` - AI email editing with existing MJML (Gemini)
- `POST /api/newsletters/:id/suggest-subjects` - AI subject line suggestions
- `POST /api/newsletters/:id/send-for-review` - Create review token
- `POST /api/newsletters/:id/restore/:versionId` - Restore version
- `GET /api/newsletters/:id/export` - Export HTML

### Review (Public)
- `GET /api/review/:token` - Get review page data
- `POST /api/review/:token/approve` - Approve newsletter
- `POST /api/review/:token/request-changes` - Request revisions

### Subscriptions
- `GET /api/clients/:clientId/subscriptions` - List client subscriptions
- `POST /api/clients/:clientId/subscriptions` - Create subscription (auto-queues newsletters if active)
- `PATCH /api/subscriptions/:id` - Update subscription

### Invoices
- `GET /api/invoices` - List all invoices (enriched with client data)
- `GET /api/clients/:clientId/invoices` - List client invoices
- `POST /api/clients/:clientId/invoices` - Create invoice (auto-links to subscription, creates newsletter)
- `PATCH /api/invoices/:id` - Update invoice

### Templates
- `GET /api/templates` - List all HTML templates
- `POST /api/templates` - Create template
- `GET /api/templates/:id` - Get template
- `PATCH /api/templates/:id` - Update template

## Running the Project

```bash
npm run dev    # Start development server
npm run db:push # Push schema to database
```

The app runs on port 5000 with both frontend and backend served together.

## User Preferences

- Design style: Japanese minimalism
- Primary accent: Forest green (#1a5f4a)
- Font: Inter (sans)
- Dark mode: Fully supported with theme toggle
