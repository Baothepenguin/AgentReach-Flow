# AgentReach FLOW 2.0

AI-orchestrated internal command center for producing branded real estate email newsletters.

## Overview

AgentReach FLOW is a newsletter production system for real estate agents that enables:
- AI-powered content generation and editing
- Module-based email newsletter composition
- Client review workflow with tokenized links
- HTML email compilation with Outlook/Gmail compatibility (VML support)

## Architecture

### Frontend (React + TypeScript)
- **2-Level Navigation**:
  - Master Dashboard (`/`) - Client grid view with search
  - Client Profile (`/clients/:id`) - 3-column layout:
    - Left (280px): Client DNA + campaigns list
    - Center: Newsletter editor/preview
    - Right (320px): Module panel, versions, AI drafts
- **Routing**: Wouter for client-side routing
- **State**: TanStack Query for server state, React context for auth
- **Styling**: Tailwind CSS with shadcn/ui components
- **Design**: Japanese minimalism with Inter font, forest green accent (#1a5f4a)

### Backend (Express + TypeScript)
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Session-based with express-session
- **AI**: OpenAI via Replit AI Integrations (gpt-4.1)
- **Email**: HTML compiler with VML support for Outlook

## Key Files

### Schema & Types
- `shared/schema.ts` - Drizzle schemas and TypeScript types for all entities
  - Users, Clients, ClientDna, Assets, Newsletters, NewsletterVersions
  - AI Drafts, TasksFlags, ReviewTokens, IntegrationSettings
  - Newsletter module type system (11 module types)

### Backend
- `server/routes.ts` - All API endpoints
- `server/storage.ts` - DatabaseStorage class for data access
- `server/ai-service.ts` - AI intent router and content generation
- `server/email-compiler.ts` - HTML email compilation with VML

### Frontend
- `client/src/App.tsx` - Root component with auth and routing
- `client/src/pages/master-dashboard.tsx` - Client grid view (home page)
- `client/src/pages/client-profile.tsx` - 3-column client workspace
- `client/src/pages/dashboard.tsx` - Legacy dashboard (deprecated)
- `client/src/pages/login.tsx` - Login/register page
- `client/src/pages/review.tsx` - Client review page (tokenized)
- `client/src/contexts/AuthContext.tsx` - Auth state management
- `client/src/components/` - All UI components

## Database Schema

### Core Tables
- `users` - Producer accounts (email, name, role)
- `clients` - Client profiles (name, email, location, status)
- `client_dna` - Brand/tone preferences for each client
- `newsletters` - Newsletter instances (title, period, status)
- `newsletter_versions` - Version snapshots with JSON document
- `ai_drafts` - AI-generated content with sources
- `tasks_flags` - Validation warnings and blockers
- `review_tokens` - Secure client review links

## Newsletter Module System

11 module types supported:
1. **HeaderNav** - Logo and navigation links
2. **Hero** - Title with optional background image
3. **RichText** - Formatted text content
4. **EventsList** - Local community events
5. **CTA** - Call-to-action with button
6. **MarketUpdate** - Market insights and metrics
7. **NewsCards** - News article summaries
8. **ListingsGrid** - Property listings
9. **Testimonial** - Client quote
10. **AgentBio** - Agent contact info
11. **FooterCompliance** - Legal/brokerage info

## API Endpoints

### Auth
- `POST /api/auth/register` - Register new producer
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout

### Clients
- `GET /api/clients` - List all clients
- `POST /api/clients` - Create client
- `GET /api/clients/:id` - Get client with DNA
- `PATCH /api/clients/:id` - Update client

### Newsletters
- `GET /api/clients/:clientId/newsletters` - List newsletters
- `POST /api/clients/:clientId/newsletters` - Create newsletter
- `GET /api/newsletters/:id` - Get newsletter with document, versions, flags
- `PATCH /api/newsletters/:id` - Update newsletter
- `PATCH /api/newsletters/:id/modules/:moduleId` - Update module
- `POST /api/newsletters/:id/ai-command` - Execute AI command
- `POST /api/newsletters/:id/generate-content` - Generate AI content
- `POST /api/newsletters/:id/send-for-review` - Create review token
- `GET /api/newsletters/:id/export` - Export HTML

### Review (Public)
- `GET /api/review/:token` - Get review page data
- `POST /api/review/:token/approve` - Approve newsletter
- `POST /api/review/:token/request-changes` - Request revisions

## Running the Project

```bash
npm run dev    # Start development server
npm run db:push # Push schema to database
```

The app runs on port 5000 with both frontend and backend served together.

## User Preferences

- Design style: Japanese minimalism
- Primary accent: Forest green (#1a5f4a)
- Font: Inter (sans), Georgia (serif for headings in emails)
- Dark mode: Fully supported with theme toggle
