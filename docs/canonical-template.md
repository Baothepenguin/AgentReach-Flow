# Canonical Newsletter Template Documentation

This document describes the standard newsletter template structure used by AgentReach FLOW for real estate agent newsletters.

## Template Overview

The canonical template (`canonical-001`) is a responsive HTML email template optimized for:
- **Outlook/VML compatibility** - Uses VML for background images in Outlook
- **Gmail support** - Inline styles and compatible CSS
- **Mobile responsiveness** - Stacks to single column on small screens
- **Brand customization** - Theme colors, fonts, and assets are configurable

## Module Structure

The template consists of 11 module types arranged in a specific order:

### 1. HeaderNav
**Purpose**: Logo and navigation links at the top
```json
{
  "id": "header-1",
  "type": "HeaderNav",
  "props": {
    "logoUrl": "[Client Logo URL]",
    "navLinks": [
      { "label": "View Listings", "url": "#" },
      { "label": "Contact Me", "url": "#" }
    ]
  }
}
```

### 2. Hero
**Purpose**: Main banner with title and optional background image
```json
{
  "id": "hero-1",
  "type": "Hero",
  "props": {
    "title": "Your Monthly Real Estate Newsletter",
    "subtitle": "Market insights, local events, and more",
    "backgroundUrl": "[Hero Background Image URL]"
  }
}
```

### 3. RichText (Welcome)
**Purpose**: Personal welcome message from the agent
```json
{
  "id": "welcome-1",
  "type": "RichText",
  "props": {
    "content": "<p>Welcome to this month's newsletter! Here's what's happening in your local real estate market and community.</p>"
  }
}
```

### 4. EventsList
**Purpose**: Local community events
```json
{
  "id": "events-1",
  "type": "EventsList",
  "props": {
    "title": "Upcoming Local Events",
    "events": [
      {
        "name": "Community Farmers Market",
        "startDate": "2025-01-15",
        "endDate": "2025-01-15",
        "address": "123 Main Street",
        "city": "Anytown",
        "region": "State",
        "url": "https://example.com/event",
        "sourceName": "Event Source",
        "sourceDate": "2025-01-01"
      }
    ]
  }
}
```

### 5. MarketUpdate
**Purpose**: Local real estate market insights and metrics
```json
{
  "id": "market-1",
  "type": "MarketUpdate",
  "props": {
    "title": "Market Update",
    "paragraphs": [
      "The local real estate market continues to show strong activity...",
      "Inventory levels remain competitive..."
    ],
    "metrics": [
      { "label": "Median Home Price", "value": "$450,000", "sourceUrl": "#" },
      { "label": "Days on Market", "value": "28", "sourceUrl": "#" },
      { "label": "Active Listings", "value": "150", "sourceUrl": "#" }
    ]
  }
}
```

### 6. NewsCards
**Purpose**: Curated news articles relevant to real estate/community
```json
{
  "id": "news-1",
  "type": "NewsCards",
  "props": {
    "title": "In The News",
    "items": [
      {
        "headline": "New Development Announced Downtown",
        "summary": "City officials announced plans for a new mixed-use development...",
        "imageUrl": "[Article Image URL]",
        "url": "https://example.com/news",
        "sourceName": "Local News",
        "sourceDate": "2025-01-05"
      }
    ]
  }
}
```

### 7. ListingsGrid
**Purpose**: Featured property listings
```json
{
  "id": "listings-1",
  "type": "ListingsGrid",
  "props": {
    "title": "Featured Listings",
    "listings": [
      {
        "imageUrl": "[Property Image URL]",
        "price": "$425,000",
        "beds": 3,
        "baths": 2,
        "address": "123 Oak Street",
        "url": "https://example.com/listing"
      }
    ]
  }
}
```

### 8. CTA
**Purpose**: Call-to-action with button
```json
{
  "id": "cta-1",
  "type": "CTA",
  "props": {
    "headline": "Ready to Buy or Sell?",
    "buttonText": "Contact Me Today",
    "buttonUrl": "mailto:agent@example.com",
    "backgroundUrl": "[Optional Background]"
  }
}
```

### 9. Testimonial
**Purpose**: Client testimonial quote
```json
{
  "id": "testimonial-1",
  "type": "Testimonial",
  "props": {
    "quote": "Working with [Agent Name] was an amazing experience. They helped us find our dream home!",
    "author": "Happy Client",
    "role": "First-Time Homebuyer"
  }
}
```

### 10. AgentBio
**Purpose**: Agent contact information and social links
```json
{
  "id": "bio-1",
  "type": "AgentBio",
  "props": {
    "photoUrl": "[Agent Headshot URL]",
    "name": "[Agent Name]",
    "title": "REALTOR",
    "phone": "(555) 123-4567",
    "email": "agent@example.com",
    "socials": [
      { "platform": "facebook", "url": "https://facebook.com/agent" },
      { "platform": "instagram", "url": "https://instagram.com/agent" },
      { "platform": "linkedin", "url": "https://linkedin.com/in/agent" }
    ]
  }
}
```

### 11. FooterCompliance
**Purpose**: Legal disclaimers, brokerage info, unsubscribe
```json
{
  "id": "footer-1",
  "type": "FooterCompliance",
  "props": {
    "copyright": "2025 [Agent Name]. All rights reserved.",
    "brokerage": "[Brokerage Name] | [License Number]",
    "unsubscribeText": "You received this email because you are subscribed to our newsletter. Click here to unsubscribe."
  }
}
```

## Theme Configuration

The template theme controls colors and fonts:

```json
{
  "bg": "#ffffff",
  "text": "#1a1a1a",
  "accent": "#1a5f4a",
  "muted": "#6b7280",
  "fontHeading": "Georgia, serif",
  "fontBody": "Arial, sans-serif"
}
```

### Theme Properties
- **bg**: Background color (typically white)
- **text**: Primary text color
- **accent**: Brand accent color (buttons, links, highlights)
- **muted**: Secondary/muted text color
- **fontHeading**: Font for headings (use web-safe fonts)
- **fontBody**: Font for body text

## Populating from Branding Kit

When creating a newsletter, the template is automatically populated with data from the client's branding kit:

| Template Field | Branding Kit Field |
|----------------|-------------------|
| theme.accent | primaryColor |
| HeaderNav.logoUrl | logo |
| AgentBio.photoUrl | headshot |
| AgentBio.name | Client name |
| AgentBio.title | title |
| AgentBio.phone | phone |
| AgentBio.email | email |
| AgentBio.socials | facebook, instagram, linkedin, youtube, website |
| FooterCompliance.brokerage | companyName |

## Email Compilation Notes

The HTML compiler handles:
1. **VML backgrounds** - Outlook-compatible background images using v:rect
2. **Inline styles** - All CSS is inlined for maximum compatibility
3. **Responsive tables** - Uses max-width and media queries for mobile
4. **Image placeholders** - Shows placeholder if images are missing
5. **Font fallbacks** - Web-safe font stacks for all text

## Best Practices

1. **Keep content concise** - Email readers scan quickly
2. **Use high-quality images** - Recommend 600px wide minimum
3. **Test on multiple clients** - Always preview in Outlook and Gmail
4. **Personalize the welcome** - AI can help generate personalized greetings
5. **Include clear CTAs** - Make it easy for readers to contact the agent
