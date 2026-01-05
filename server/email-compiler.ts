import type { NewsletterDocument, NewsletterModule, NewsletterTheme } from "@shared/schema";

export function compileNewsletterToHtml(doc: NewsletterDocument): string {
  if (doc.html) {
    return doc.html;
  }
  
  const { theme, modules } = doc;
  
  const styles = `
    body, table, td, p, a, li, blockquote { 
      -webkit-text-size-adjust: 100%; 
      -ms-text-size-adjust: 100%; 
    }
    table, td { 
      mso-table-lspace: 0pt; 
      mso-table-rspace: 0pt; 
    }
    img { 
      -ms-interpolation-mode: bicubic; 
      border: 0; 
      height: auto; 
      line-height: 100%; 
      outline: none; 
      text-decoration: none; 
    }
    body { 
      margin: 0 !important; 
      padding: 0 !important; 
      width: 100% !important; 
    }
    a { color: ${theme.accent}; }
    .button { 
      display: inline-block; 
      padding: 14px 28px; 
      background-color: ${theme.accent}; 
      color: #ffffff !important; 
      text-decoration: none; 
      border-radius: 6px; 
      font-weight: 600; 
    }
    @media screen and (max-width: 600px) {
      .container { width: 100% !important; }
      .mobile-padding { padding: 20px !important; }
      .mobile-center { text-align: center !important; }
    }
  `;

  const moduleHtml = modules.map((m) => compileModule(m, theme)).join("\n");

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>Newsletter</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">${styles}</style>
</head>
<body style="margin: 0; padding: 0; background-color: ${theme.bg}; font-family: ${theme.fontBody}; color: ${theme.text};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${theme.bg};">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table role="presentation" class="container" width="680" cellpadding="0" cellspacing="0" border="0" style="max-width: 680px; width: 100%;">
          ${moduleHtml}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function compileModule(module: NewsletterModule, theme: NewsletterTheme): string {
  switch (module.type) {
    case "HeaderNav":
      return compileHeaderNav(module.props, theme);
    case "Hero":
      return compileHero(module.props, theme);
    case "RichText":
      return compileRichText(module.props, theme);
    case "EventsList":
      return compileEventsList(module.props, theme);
    case "CTA":
      return compileCTA(module.props, theme);
    case "MarketUpdate":
      return compileMarketUpdate(module.props, theme);
    case "NewsCards":
      return compileNewsCards(module.props, theme);
    case "ListingsGrid":
      return compileListingsGrid(module.props, theme);
    case "Testimonial":
      return compileTestimonial(module.props, theme);
    case "AgentBio":
      return compileAgentBio(module.props, theme);
    case "FooterCompliance":
      return compileFooterCompliance(module.props, theme);
    default:
      return "";
  }
}

function compileHeaderNav(props: Record<string, unknown>, theme: NewsletterTheme): string {
  const logoUrl = props.logoUrl as string | undefined;
  const navLinks = (props.navLinks || []) as Array<{ label: string; url: string }>;

  return `
    <tr>
      <td style="padding: 20px 30px; background-color: #ffffff;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="text-align: left;">
              ${logoUrl ? `<img src="${logoUrl}" alt="Logo" style="max-height: 50px; width: auto;">` : ""}
            </td>
            <td style="text-align: right;">
              ${navLinks.map((link) => `<a href="${link.url}" style="color: ${theme.text}; text-decoration: none; margin-left: 20px; font-size: 14px;">${link.label}</a>`).join("")}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function compileHero(props: Record<string, unknown>, theme: NewsletterTheme): string {
  const title = (props.title as string) || "";
  const subtitle = props.subtitle as string | undefined;
  const backgroundUrl = props.backgroundUrl as string | undefined;

  const bgStyle = backgroundUrl
    ? `background-image: url('${backgroundUrl}'); background-size: cover; background-position: center;`
    : `background-color: ${theme.accent};`;

  const vmlBg = backgroundUrl
    ? `<!--[if gte mso 9]>
    <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:680px;height:300px;">
      <v:fill type="frame" src="${backgroundUrl}" />
      <v:textbox inset="0,0,0,0">
    <![endif]-->`
    : "";

  const vmlEnd = backgroundUrl
    ? `<!--[if gte mso 9]>
      </v:textbox>
    </v:rect>
    <![endif]-->`
    : "";

  return `
    <tr>
      <td>
        ${vmlBg}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${bgStyle}">
          <tr>
            <td style="padding: 80px 40px; text-align: center;">
              <h1 style="margin: 0; font-family: ${theme.fontHeading}; font-size: 36px; font-weight: 700; color: #ffffff; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">${title}</h1>
              ${subtitle ? `<p style="margin: 16px 0 0; font-size: 18px; color: rgba(255,255,255,0.9);">${subtitle}</p>` : ""}
            </td>
          </tr>
        </table>
        ${vmlEnd}
      </td>
    </tr>
  `;
}

function compileRichText(props: Record<string, unknown>, theme: NewsletterTheme): string {
  const content = (props.content as string) || "";
  return `
    <tr>
      <td class="mobile-padding" style="padding: 30px; background-color: #ffffff;">
        <div style="font-size: 16px; line-height: 1.7; color: ${theme.text};">
          ${content.replace(/\n/g, "<br>")}
        </div>
      </td>
    </tr>
  `;
}

function compileEventsList(props: Record<string, unknown>, theme: NewsletterTheme): string {
  const title = (props.title as string) || "Upcoming Events";
  const events = (props.events || []) as Array<{
    name: string;
    startDate: string;
    endDate?: string;
    address?: string;
    city?: string;
    url?: string;
  }>;

  if (events.length === 0) return "";

  const eventRows = events
    .map(
      (event) => `
      <tr>
        <td style="padding: 16px 0; border-bottom: 1px solid #eee;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="70" style="vertical-align: top; padding-right: 16px;">
                <div style="background-color: ${theme.accent}; color: #ffffff; text-align: center; padding: 10px; border-radius: 6px;">
                  <div style="font-size: 12px; text-transform: uppercase;">${new Date(event.startDate).toLocaleDateString("en-US", { month: "short" })}</div>
                  <div style="font-size: 24px; font-weight: bold;">${new Date(event.startDate).getDate()}</div>
                </div>
              </td>
              <td style="vertical-align: top;">
                <h3 style="margin: 0 0 4px; font-size: 16px; font-weight: 600;">${event.name}</h3>
                <p style="margin: 0; font-size: 14px; color: ${theme.muted};">
                  ${event.address || ""}${event.city ? `, ${event.city}` : ""}
                </p>
                ${event.url ? `<a href="${event.url}" style="font-size: 13px; color: ${theme.accent};">Learn more</a>` : ""}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `
    )
    .join("");

  return `
    <tr>
      <td class="mobile-padding" style="padding: 30px; background-color: #ffffff;">
        <h2 style="margin: 0 0 20px; font-family: ${theme.fontHeading}; font-size: 24px; color: ${theme.text};">${title}</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${eventRows}
        </table>
      </td>
    </tr>
  `;
}

function compileCTA(props: Record<string, unknown>, theme: NewsletterTheme): string {
  const headline = (props.headline as string) || "";
  const buttonText = (props.buttonText as string) || "Learn More";
  const buttonUrl = (props.buttonUrl as string) || "#";
  const backgroundUrl = props.backgroundUrl as string | undefined;

  const bgStyle = backgroundUrl
    ? `background-image: url('${backgroundUrl}'); background-size: cover; background-position: center;`
    : `background-color: ${theme.accent};`;

  return `
    <tr>
      <td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${bgStyle}">
          <tr>
            <td style="padding: 50px 40px; text-align: center;">
              <h2 style="margin: 0 0 20px; font-family: ${theme.fontHeading}; font-size: 28px; color: #ffffff;">${headline}</h2>
              <a href="${buttonUrl}" class="button" style="display: inline-block; padding: 14px 28px; background-color: #ffffff; color: ${theme.accent} !important; text-decoration: none; border-radius: 6px; font-weight: 600;">${buttonText}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function compileMarketUpdate(props: Record<string, unknown>, theme: NewsletterTheme): string {
  const title = (props.title as string) || "Market Update";
  const paragraphs = (props.paragraphs || []) as string[];
  const metrics = (props.metrics || []) as Array<{ label: string; value: string }>;

  if (paragraphs.length === 0 && metrics.length === 0) return "";

  const metricsHtml =
    metrics.length > 0
      ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 20px;">
        <tr>
          ${metrics
            .map(
              (m) => `
            <td style="text-align: center; padding: 20px; background-color: #f8f9fa; border-radius: 6px;">
              <div style="font-size: 32px; font-weight: bold; color: ${theme.accent};">${m.value}</div>
              <div style="font-size: 13px; color: ${theme.muted}; margin-top: 4px;">${m.label}</div>
            </td>
          `
            )
            .join('<td width="20"></td>')}
        </tr>
      </table>
    `
      : "";

  return `
    <tr>
      <td class="mobile-padding" style="padding: 30px; background-color: #ffffff;">
        <h2 style="margin: 0 0 20px; font-family: ${theme.fontHeading}; font-size: 24px; color: ${theme.text};">${title}</h2>
        ${paragraphs.map((p) => `<p style="margin: 0 0 16px; font-size: 16px; line-height: 1.7; color: ${theme.text};">${p}</p>`).join("")}
        ${metricsHtml}
      </td>
    </tr>
  `;
}

function compileNewsCards(props: Record<string, unknown>, theme: NewsletterTheme): string {
  const title = (props.title as string) || "In The News";
  const items = (props.items || []) as Array<{
    headline: string;
    summary: string;
    imageUrl?: string;
    url: string;
    sourceName: string;
  }>;

  if (items.length === 0) return "";

  const newsRows = items
    .map(
      (item) => `
      <tr>
        <td style="padding: 20px 0; border-bottom: 1px solid #eee;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              ${item.imageUrl ? `<td width="120" style="vertical-align: top; padding-right: 16px;"><img src="${item.imageUrl}" alt="" style="width: 100%; border-radius: 6px;"></td>` : ""}
              <td style="vertical-align: top;">
                <a href="${item.url}" style="text-decoration: none;">
                  <h3 style="margin: 0 0 8px; font-size: 16px; font-weight: 600; color: ${theme.text};">${item.headline}</h3>
                </a>
                <p style="margin: 0 0 8px; font-size: 14px; line-height: 1.5; color: ${theme.muted};">${item.summary}</p>
                <span style="font-size: 12px; color: ${theme.muted};">${item.sourceName}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `
    )
    .join("");

  return `
    <tr>
      <td class="mobile-padding" style="padding: 30px; background-color: #ffffff;">
        <h2 style="margin: 0 0 20px; font-family: ${theme.fontHeading}; font-size: 24px; color: ${theme.text};">${title}</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${newsRows}
        </table>
      </td>
    </tr>
  `;
}

function compileListingsGrid(props: Record<string, unknown>, theme: NewsletterTheme): string {
  const title = (props.title as string) || "Featured Listings";
  const listings = (props.listings || []) as Array<{
    imageUrl?: string;
    price: string;
    beds?: number;
    baths?: number;
    address?: string;
    url?: string;
  }>;

  if (listings.length === 0) return "";

  const listingCells = listings
    .slice(0, 3)
    .map(
      (listing) => `
      <td width="33%" style="vertical-align: top; padding: 10px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8f9fa; border-radius: 6px; overflow: hidden;">
          ${listing.imageUrl ? `<tr><td><img src="${listing.imageUrl}" alt="" style="width: 100%; display: block;"></td></tr>` : ""}
          <tr>
            <td style="padding: 16px;">
              <div style="font-size: 18px; font-weight: bold; color: ${theme.accent};">${listing.price}</div>
              <div style="font-size: 13px; color: ${theme.muted}; margin-top: 4px;">
                ${listing.beds ? `${listing.beds} bed` : ""}${listing.baths ? ` | ${listing.baths} bath` : ""}
              </div>
              ${listing.address ? `<div style="font-size: 13px; color: ${theme.text}; margin-top: 4px;">${listing.address}</div>` : ""}
              ${listing.url ? `<a href="${listing.url}" style="display: inline-block; margin-top: 10px; font-size: 13px; color: ${theme.accent};">View Details</a>` : ""}
            </td>
          </tr>
        </table>
      </td>
    `
    )
    .join("");

  return `
    <tr>
      <td class="mobile-padding" style="padding: 30px; background-color: #ffffff;">
        <h2 style="margin: 0 0 20px; font-family: ${theme.fontHeading}; font-size: 24px; color: ${theme.text};">${title}</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>${listingCells}</tr>
        </table>
      </td>
    </tr>
  `;
}

function compileTestimonial(props: Record<string, unknown>, theme: NewsletterTheme): string {
  const quote = (props.quote as string) || "";
  const author = (props.author as string) || "";
  const role = props.role as string | undefined;

  if (!quote) return "";

  return `
    <tr>
      <td class="mobile-padding" style="padding: 40px; background-color: #f8f9fa; text-align: center;">
        <p style="margin: 0 0 20px; font-size: 20px; font-style: italic; line-height: 1.6; color: ${theme.text};">"${quote}"</p>
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: ${theme.text};">${author}</p>
        ${role ? `<p style="margin: 4px 0 0; font-size: 13px; color: ${theme.muted};">${role}</p>` : ""}
      </td>
    </tr>
  `;
}

function compileAgentBio(props: Record<string, unknown>, theme: NewsletterTheme): string {
  const photoUrl = props.photoUrl as string | undefined;
  const name = (props.name as string) || "";
  const title = props.title as string | undefined;
  const phone = props.phone as string | undefined;
  const email = props.email as string | undefined;

  if (!name) return "";

  return `
    <tr>
      <td class="mobile-padding" style="padding: 30px; background-color: #ffffff;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            ${photoUrl ? `<td width="100" style="vertical-align: top; padding-right: 20px;"><img src="${photoUrl}" alt="${name}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover;"></td>` : ""}
            <td style="vertical-align: middle;">
              <h3 style="margin: 0 0 4px; font-size: 18px; font-weight: 600; color: ${theme.text};">${name}</h3>
              ${title ? `<p style="margin: 0 0 12px; font-size: 14px; color: ${theme.muted};">${title}</p>` : ""}
              ${phone ? `<p style="margin: 0 0 4px; font-size: 14px; color: ${theme.text};">${phone}</p>` : ""}
              ${email ? `<p style="margin: 0; font-size: 14px;"><a href="mailto:${email}" style="color: ${theme.accent};">${email}</a></p>` : ""}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function compileFooterCompliance(props: Record<string, unknown>, theme: NewsletterTheme): string {
  const copyright = (props.copyright as string) || `© ${new Date().getFullYear()} All rights reserved.`;
  const brokerage = props.brokerage as string | undefined;
  const unsubscribeText = (props.unsubscribeText as string) || "Unsubscribe";

  return `
    <tr>
      <td style="padding: 30px; background-color: #f8f9fa; text-align: center;">
        ${brokerage ? `<p style="margin: 0 0 16px; font-size: 13px; color: ${theme.muted};">${brokerage}</p>` : ""}
        <p style="margin: 0 0 8px; font-size: 12px; color: ${theme.muted};">${copyright}</p>
        <p style="margin: 0; font-size: 12px;">
          <a href="{{unsubscribe_url}}" style="color: ${theme.muted};">${unsubscribeText}</a>
        </p>
      </td>
    </tr>
  `;
}
