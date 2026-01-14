# AgentReach FLOW 2.0

Client portal and CRM for managing real estate email newsletters.

## Overview

AgentReach FLOW is a newsletter production system for real estate agents that enables:
- Visual email editor (Unlayer) with drag-and-drop blocks
- Simple HTML mode for paste/preview/edit workflows
- Client review workflow with tokenized links
- Automatic sender verification via Postmark
- Version history tracking
- Status pipeline (7 stages from not_started to sent)
- Project-based organization (Client -> Project -> Newsletter hierarchy)
- HTML templates for newsletter starting points

## Architecture

### Frontend (React + TypeScript)
- **2-Level Navigation**:
  - Master Dashboard (`/`) - Client view with Grid/List/Calendar toggle
    - Grid: Card layout for quick browsing
    - List: Tabular view with sortable columns
    - Calendar: Monthly view showing newsletter due dates
  - Client Profile (`/clients/:id`) - 3-column layout:
    - Left (280px): Client DNA + Projects & Campaigns (collapsible with folder hierarchy)
    - Center: Unlayer visual editor OR HTML mode (toggle between modes)
    - Right (256px): Version history + status
- **Routing**: Wouter for client-side routing
- **State**: TanStack Query for server state, React context for auth
- **Styling**: Tailwind CSS with shadcn/ui components
- **Design**: Japanese minimalism with Inter font, forest green accent (#1a5f4a)

### Backend (Express + TypeScript)
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Session-based with express-session
- **AI**: Optional OpenAI for HTML editing (gpt-4.1)
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
- `server/ai-service.ts` - Optional AI HTML editing
- `server/email-compiler.ts` - Returns raw HTML from document
- `server/postmark-service.ts` - Postmark sender signature management

### Frontend
- `client/src/App.tsx` - Root component with auth and routing
- `client/src/pages/master-dashboard.tsx` - Client grid view (home page)
- `client/src/pages/client-profile.tsx` - 3-column client workspace
- `client/src/pages/login.tsx` - Login/register page
- `client/src/pages/review.tsx` - Client review page (tokenized)
- `client/src/components/HTMLPreviewFrame.tsx` - Click-to-edit HTML preview
- `client/src/components/UnlayerEditor.tsx` - Visual drag-and-drop email editor
- `client/src/components/RightPanel.tsx` - Version history + status
- `client/src/components/CreateNewsletterDialog.tsx` - New campaign with HTML import

## Database Schema

### Core Tables
- `users` - Producer accounts (email, name, role)
- `clients` - Client profiles (name, email, location, status)
- `branding_kits` - Brand preferences for each client
- `html_templates` - Base HTML templates for newsletters
- `projects` - Client projects that group newsletters
- `newsletters` - Newsletter instances (title, period, status, documentJson)
- `newsletter_versions` - Version snapshots
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
- `POST /api/newsletters/:id/ai-command` - AI HTML editing (optional)
- `POST /api/newsletters/:id/send-for-review` - Create review token
- `POST /api/newsletters/:id/restore/:versionId` - Restore version
- `GET /api/newsletters/:id/export` - Export HTML

### Review (Public)
- `GET /api/review/:token` - Get review page data
- `POST /api/review/:token/approve` - Approve newsletter
- `POST /api/review/:token/request-changes` - Request revisions

### Projects
- `GET /api/clients/:clientId/projects` - List client projects
- `POST /api/clients/:clientId/projects` - Create project
- `GET /api/projects/:id` - Get project
- `PATCH /api/projects/:id` - Update project

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
