# AgentReach FLOW 2.0 Design Guidelines

## Design Approach
**Japanese Minimalism with Productivity Focus** - Drawing inspiration from Linear's clarity and Notion's content hierarchy, adapted for an internal newsletter production tool. This is a utility-focused application where efficiency and information density matter most.

## Core Design Principles
1. **Clarity over decoration** - Every element serves a functional purpose
2. **Breathing room** - Generous spacing between dense information clusters
3. **Surgical precision** - Actions are clear, contextual, and non-destructive
4. **Progressive disclosure** - Complexity hidden until needed

---

## Typography

**Font Families:**
- Headings: Inter (600 weight)
- Body/UI: Inter (400, 500 weights)
- Code/Technical: JetBrains Mono (newsletter JSON, module IDs)

**Scale:**
- Page titles: text-2xl font-semibold
- Section headers: text-lg font-semibold
- Module labels: text-sm font-medium
- Body text: text-sm
- Captions/meta: text-xs text-gray-500

---

## Layout System

**Spacing Primitives:** Use Tailwind units of 2, 3, 4, 6, 8, 12 for consistency
- Component padding: p-4, p-6
- Section gaps: gap-4, gap-6
- Major spacing: mt-8, mb-12

**Three-Column Application Structure:**

**Left Sidebar (280px fixed):**
- Client list with status indicators
- Search/filter controls
- Client DNA quick-view on hover
- Scrollable, always visible

**Main Editor Area (flexible, max-w-4xl centered):**
- Newsletter preview iframe (responsive width simulation)
- Module reorder drag handles on left edge
- Inline edit forms appear in context
- Version indicator header

**Right Panel (360px, collapsible tabs):**
- Tab bar: Modules | AI Draft | Sources | Warnings | History
- Each tab full-height scroll
- Sources panel shows citation cards with URLs
- Warnings show severity badges (info/warning/blocker)

---

## Component Library

### Navigation & Status
- **Status Pills:** Rounded-full px-3 py-1 text-xs with semantic colors (draft: gray, review: yellow, approved: green, blocker: red)
- **Client Cards:** Hover state shows mini-preview, click opens client in editor
- **Breadcrumbs:** text-sm with chevron separators

### Forms & Inputs
- **Text Inputs:** border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-green-600
- **Dropdowns:** Custom styled with down chevron, rounded corners
- **Textareas:** min-h-32 for comments/notes
- **Module Property Forms:** Label-above-input, helper text below in text-xs text-gray-500

### Buttons
- **Primary (Green):** bg-green-700 hover:bg-green-800 text-white rounded-lg px-6 py-2.5 font-medium
- **Secondary:** border border-gray-300 hover:bg-gray-50 rounded-lg px-6 py-2.5
- **Ghost:** hover:bg-gray-100 rounded-lg px-3 py-2
- **Danger:** bg-red-600 hover:bg-red-700 (for destructive actions)
- Glass buttons for floating actions: backdrop-blur bg-white/80 shadow-lg

### Data Display
- **Module Cards:** White bg, border-l-4 with type-specific accent (Hero: blue, Events: purple, CTA: green), p-4, rounded-r-lg
- **Drag Handles:** 6 dots in grid, gray-300, visible on hover
- **Source Citations:** Small cards with favicon, source name, date, URL in text-xs
- **Metrics/Stats:** Large numbers (text-3xl font-bold) with small labels below

### Panels & Overlays
- **Right Panel Tabs:** Underline on active, text-sm font-medium
- **AI Command Box:** Floating modal, center screen, rounded-2xl shadow-2xl, p-6
- **Confirmation Dialogs:** Centered overlay with backdrop-blur, rounded-xl
- **Version History Timeline:** Vertical line with version dots, expandable detail cards

### Feedback & Validation
- **Flags/Warnings Panel:** Cards with left border (info: blue, warning: yellow, blocker: red)
- **Inline Validation:** Small icon + text below field, color-coded
- **Success Toast:** Slide in from top-right, auto-dismiss, green accent
- **Loading States:** Subtle spinner for async operations, skeleton loaders for content

---

## Animations

**Minimal, purposeful only:**
- Tab transitions: 150ms ease
- Hover states: 100ms ease
- Modal open/close: 200ms ease with slight scale (0.95 to 1)
- Drag-and-drop: Immediate visual feedback, subtle drop shadow on dragged item
- NO scroll animations, parallax, or decorative motion

---

## Newsletter Preview Specifics

**Preview Frame:**
- iframe with mobile (375px) / tablet (768px) / desktop (1200px) width toggles
- Shadow-2xl on iframe for depth
- Centered in main area with subtle background pattern (light grid dots)
- Device chrome optional (toggle)

**Module Selection:**
- Click module in preview highlights corresponding card in right panel
- Selected module shows outline in preview (2px solid green-600)

---

## Client Review Page

**Standalone minimal interface:**
- Centered preview (max-w-3xl)
- Top bar: Client logo + Newsletter title
- Preview takes 70% height
- Bottom action bar (sticky): Approve (green primary) | Request Changes (secondary) with expand-up comment box
- Mobile-responsive: Stack vertically, full-width buttons

---

## Quality Standards

- All interactive elements have clear hover/focus states
- Maintain 4.5:1 contrast ratio minimum
- Touch targets minimum 44x44px
- Keyboard navigation for all critical paths
- Form validation shows before submission attempt
- Error states are constructive with next-step guidance

---

## Images

**Not applicable** - This is an internal productivity tool with no marketing components. Any imagery will be user-uploaded client assets (logos, headshots, listing photos) displayed in context within the newsletter preview or client profile headers.