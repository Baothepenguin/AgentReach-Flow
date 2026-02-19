export type ClientStatus = "active" | "paused" | "past_due" | "canceled";
export type NewsletterStatus = "draft" | "in_review" | "changes_requested" | "approved" | "scheduled" | "sent";
export type FlagSeverity = "info" | "warning" | "blocker";
export type ModuleType = "HeaderNav" | "Hero" | "RichText" | "EventsList" | "CTA" | "MarketUpdate" | "NewsCards" | "ListingsGrid" | "Testimonial" | "AgentBio" | "FooterCompliance";

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active: "Active",
  paused: "Paused",
  past_due: "Past Due",
  canceled: "Canceled",
};

export const NEWSLETTER_STATUS_LABELS: Record<NewsletterStatus, string> = {
  draft: "Draft",
  in_review: "In Review",
  changes_requested: "Changes Requested",
  approved: "Approved",
  scheduled: "Scheduled",
  sent: "Sent",
};

export const MODULE_TYPE_LABELS: Record<ModuleType, string> = {
  HeaderNav: "Header & Navigation",
  Hero: "Hero Section",
  RichText: "Text Block",
  EventsList: "Events List",
  CTA: "Call to Action",
  MarketUpdate: "Market Update",
  NewsCards: "News Cards",
  ListingsGrid: "Listings Grid",
  Testimonial: "Testimonial",
  AgentBio: "Agent Bio",
  FooterCompliance: "Footer",
};

export const MODULE_TYPE_COLORS: Record<ModuleType, string> = {
  HeaderNav: "border-l-slate-500",
  Hero: "border-l-blue-500",
  RichText: "border-l-gray-500",
  EventsList: "border-l-purple-500",
  CTA: "border-l-sky-500",
  MarketUpdate: "border-l-amber-500",
  NewsCards: "border-l-indigo-500",
  ListingsGrid: "border-l-rose-500",
  Testimonial: "border-l-cyan-500",
  AgentBio: "border-l-slate-500",
  FooterCompliance: "border-l-gray-400",
};
