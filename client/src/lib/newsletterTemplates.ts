export type NewsletterTemplateId =
  | "new-york"
  | "miami"
  | "los-angeles"
  | "chicago"
  | "austin";

export type NewsletterTemplate = {
  id: NewsletterTemplateId;
  name: string;
  tagline: string;
  html: string;
};

// Simple, table-based templates intended as starter "issue #1" designs.
// After issue #1, Flow defaults to cloning the latest newsletter for that client.
export const NEWSLETTER_TEMPLATES: NewsletterTemplate[] = [
  {
    id: "new-york",
    name: "New York",
    tagline: "Editorial, high-contrast, minimal",
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Newsletter</title>
    <style>
      body { margin:0; padding:0; background:#f6f6f6; color:#111827; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, "Apple Color Emoji", "Segoe UI Emoji"; }
      a { color:#111827; }
      .container { width:100%; background:#f6f6f6; }
      .card { width:680px; max-width:680px; background:#ffffff; border:1px solid #e5e7eb; }
      .pad { padding:28px; }
      .h1 { font-family: Georgia, "Times New Roman", Times, serif; font-size:28px; line-height:1.25; letter-spacing:-0.02em; margin:0; }
      .h2 { font-size:14px; letter-spacing:0.12em; text-transform:uppercase; margin:0; color:#111827; }
      .p { font-size:15px; line-height:1.7; margin:0; color:#111827; }
      .muted { color:#6b7280; }
      .rule { height:1px; background:#111827; opacity:0.12; }
      .btn { display:inline-block; background:#111827; color:#ffffff !important; text-decoration:none; padding:12px 18px; border-radius:8px; font-weight:600; }
      @media (max-width: 720px) {
        .card { width:100% !important; border-left:0; border-right:0; border-radius:0; }
        .pad { padding:20px !important; }
      }
    </style>
  </head>
  <body>
    <table role="presentation" class="container" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" style="padding:24px 0;">
          <table role="presentation" class="card" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td class="pad">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="left">
                      <div class="h2">Your Real Estate Update</div>
                    </td>
                    <td align="right" class="muted" style="font-size:12px;">
                      {{ send_date }}
                    </td>
                  </tr>
                </table>
                <div style="height:18px;"></div>
                <h1 class="h1">What’s happening in your market this week</h1>
                <div style="height:14px;"></div>
                <p class="p muted">Hi {{first_name}}, here are the highlights I’m watching for you.</p>
                <div style="height:22px;"></div>
                <div class="rule"></div>
                <div style="height:22px;"></div>

                <div class="h2">Featured Listings</div>
                <div style="height:12px;"></div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:10px; border:1px solid #e5e7eb; border-radius:12px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="160" style="vertical-align:top;">
                            <img alt="Listing photo" src="https://placehold.co/320x240/png" width="160" style="display:block; width:160px; height:auto; border-radius:10px;" />
                          </td>
                          <td style="padding-left:14px; vertical-align:top;">
                            <p class="p" style="font-weight:700;">123 Maple St</p>
                            <div style="height:4px;"></div>
                            <p class="p muted">$925,000 · 3 bd · 2 ba · 1,780 sqft</p>
                            <div style="height:12px;"></div>
                            <a class="btn" href="#" target="_blank" rel="noopener noreferrer">View details</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <div style="height:22px;"></div>
                <div class="h2">Fun Things To Do</div>
                <div style="height:10px;"></div>
                <p class="p muted">A few local picks for the weekend:</p>
                <div style="height:10px;"></div>
                <ul style="margin:0; padding-left:18px; font-size:15px; line-height:1.7; color:#111827;">
                  <li><a href="#" target="_blank" rel="noopener noreferrer">Farmers market</a> (Sat)</li>
                  <li><a href="#" target="_blank" rel="noopener noreferrer">Live music</a> (Fri)</li>
                  <li><a href="#" target="_blank" rel="noopener noreferrer">Family-friendly event</a> (Sun)</li>
                </ul>

                <div style="height:22px;"></div>
                <div class="rule"></div>
                <div style="height:22px;"></div>

                <div class="h2">Market Update</div>
                <div style="height:12px;"></div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:14px; border:1px solid #e5e7eb; border-radius:12px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="font-size:13px;" class="muted">Median Price</td>
                          <td align="right" style="font-size:13px; font-weight:700;">$812,000</td>
                        </tr>
                        <tr><td colspan="2" style="height:10px;"></td></tr>
                        <tr>
                          <td style="font-size:13px;" class="muted">Days on Market</td>
                          <td align="right" style="font-size:13px; font-weight:700;">19</td>
                        </tr>
                        <tr><td colspan="2" style="height:10px;"></td></tr>
                        <tr>
                          <td style="font-size:13px;" class="muted">New Listings</td>
                          <td align="right" style="font-size:13px; font-weight:700;">+7%</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <div style="height:22px;"></div>
                <div class="h2">Call To Action</div>
                <div style="height:10px;"></div>
                <p class="p">Want a quick pricing opinion on your home this week?</p>
                <div style="height:12px;"></div>
                <a class="btn" href="#" target="_blank" rel="noopener noreferrer">Request a home value</a>

                <div style="height:22px;"></div>
                <div class="h2">Market News</div>
                <div style="height:10px;"></div>
                <p class="p muted"><a href="#" target="_blank" rel="noopener noreferrer">Headline goes here</a> · One-sentence summary that stays calm and useful.</p>

                <div style="height:22px;"></div>
                <div class="h2">Testimonial</div>
                <div style="height:10px;"></div>
                <p class="p" style="font-style:italic;">“Incredibly smooth experience from start to finish.”</p>
                <div style="height:6px;"></div>
                <p class="p muted">— Happy Client</p>

                <div style="height:26px;"></div>
                <div class="rule"></div>
                <div style="height:16px;"></div>
                <p class="p muted" style="font-size:12px;">
                  You’re receiving this because you opted in to updates. <a href="#">Unsubscribe</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  },
  {
    id: "miami",
    name: "Miami",
    tagline: "Beach vibes, airy, playful accent",
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Newsletter</title>
    <style>
      body { margin:0; padding:0; background:#fff7ed; color:#111827; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial; }
      a { color:#f97316; }
      .card { width:680px; max-width:680px; background:#ffffff; border:1px solid rgba(17,24,39,0.10); border-radius:18px; overflow:hidden; }
      .pad { padding:26px; }
      .h1 { font-size:26px; line-height:1.25; margin:0; letter-spacing:-0.02em; }
      .p { font-size:15px; line-height:1.7; margin:0; color:#111827; }
      .muted { color:#6b7280; }
      .pill { display:inline-block; padding:6px 10px; border-radius:999px; background:#ffedd5; color:#9a3412; font-size:12px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; }
      .btn { display:inline-block; background:#f97316; color:#ffffff !important; text-decoration:none; padding:12px 18px; border-radius:999px; font-weight:700; }
      @media (max-width: 720px) {
        .card { width:100% !important; border-radius:0; border-left:0; border-right:0; }
        .pad { padding:20px !important; }
      }
    </style>
  </head>
  <body>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff7ed;">
      <tr>
        <td align="center" style="padding:24px 0;">
          <table role="presentation" class="card" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="background:linear-gradient(135deg, #fb7185 0%, #f97316 55%, #22c55e 115%); padding:18px 26px;">
                <div style="color:#fff; font-weight:800; letter-spacing:0.1em; text-transform:uppercase; font-size:12px;">
                  Weekly Highlights
                </div>
              </td>
            </tr>
            <tr>
              <td class="pad">
                <span class="pill">Hello {{first_name}}</span>
                <div style="height:14px;"></div>
                <h1 class="h1">Sunshine, listings, and a quick market pulse</h1>
                <div style="height:10px;"></div>
                <p class="p muted">A clean, colorful format that keeps it light and skimmable.</p>

                <div style="height:22px;"></div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:14px; border:1px solid rgba(17,24,39,0.12); border-radius:16px;">
                      <div style="font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em;">Featured Listings</div>
                      <div style="height:10px;"></div>
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="48%" style="vertical-align:top;">
                            <img alt="Listing photo" src="https://placehold.co/600x420/png" style="display:block; width:100%; height:auto; border-radius:14px;" />
                            <div style="height:10px;"></div>
                            <p class="p" style="font-weight:800;">456 Ocean Ave</p>
                            <p class="p muted" style="font-size:13px;">$1,150,000 · 4 bd · 3 ba</p>
                          </td>
                          <td width="4%"></td>
                          <td width="48%" style="vertical-align:top;">
                            <img alt="Listing photo" src="https://placehold.co/600x420/png" style="display:block; width:100%; height:auto; border-radius:14px;" />
                            <div style="height:10px;"></div>
                            <p class="p" style="font-weight:800;">78 Palm Ct</p>
                            <p class="p muted" style="font-size:13px;">$799,000 · 2 bd · 2 ba</p>
                          </td>
                        </tr>
                      </table>
                      <div style="height:14px;"></div>
                      <a class="btn" href="#" target="_blank" rel="noopener noreferrer">See all listings</a>
                    </td>
                  </tr>
                </table>

                <div style="height:18px;"></div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="50%" style="vertical-align:top; padding-right:6px;">
                      <div style="padding:14px; border:1px solid rgba(17,24,39,0.12); border-radius:16px;">
                        <div style="font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em;">Market Update</div>
                        <div style="height:10px;"></div>
                        <p class="p muted">Median price: <span style="font-weight:800; color:#111827;">$812k</span></p>
                        <p class="p muted">Days on market: <span style="font-weight:800; color:#111827;">19</span></p>
                        <p class="p muted">New listings: <span style="font-weight:800; color:#111827;">+7%</span></p>
                      </div>
                    </td>
                    <td width="50%" style="vertical-align:top; padding-left:6px;">
                      <div style="padding:14px; border:1px solid rgba(17,24,39,0.12); border-radius:16px;">
                        <div style="font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em;">Fun Things</div>
                        <div style="height:10px;"></div>
                        <p class="p"><a href="#" target="_blank" rel="noopener noreferrer">Beach cleanup</a></p>
                        <p class="p"><a href="#" target="_blank" rel="noopener noreferrer">Outdoor concert</a></p>
                        <p class="p"><a href="#" target="_blank" rel="noopener noreferrer">Food festival</a></p>
                      </div>
                    </td>
                  </tr>
                </table>

                <div style="height:18px;"></div>
                <div style="padding:16px; border:1px dashed rgba(17,24,39,0.18); border-radius:16px; background:#fffbeb;">
                  <div style="font-size:13px; font-weight:900;">Quick question:</div>
                  <div style="height:6px;"></div>
                  <p class="p">If you moved this year, where would you go and why?</p>
                  <div style="height:12px;"></div>
                  <a class="btn" href="#" target="_blank" rel="noopener noreferrer">Reply with your answer</a>
                </div>

                <div style="height:20px;"></div>
                <p class="p muted" style="font-size:12px;">
                  You’re receiving this because you opted in to updates. <a href="#">Unsubscribe</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  },
  {
    id: "los-angeles",
    name: "Los Angeles",
    tagline: "Modern, clean, brand-forward",
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Newsletter</title>
    <style>
      body { margin:0; padding:0; background:#0b1220; color:#0f172a; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial; }
      a { color:#2563eb; }
      .card { width:680px; max-width:680px; background:#ffffff; border-radius:16px; overflow:hidden; }
      .pad { padding:28px; }
      .hero { background:linear-gradient(135deg, rgba(37,99,235,0.14), rgba(16,185,129,0.10)); }
      .h1 { font-size:28px; line-height:1.2; margin:0; letter-spacing:-0.03em; }
      .p { font-size:15px; line-height:1.7; margin:0; color:#0f172a; }
      .muted { color:#64748b; }
      .btn { display:inline-block; background:#2563eb; color:#ffffff !important; text-decoration:none; padding:12px 18px; border-radius:10px; font-weight:800; }
      .chip { display:inline-block; padding:6px 10px; border-radius:999px; background:#e0f2fe; color:#075985; font-size:12px; font-weight:800; }
      @media (max-width: 720px) {
        .card { width:100% !important; border-radius:0; }
        .pad { padding:20px !important; }
      }
    </style>
  </head>
  <body>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b1220;">
      <tr>
        <td align="center" style="padding:24px 0;">
          <table role="presentation" class="card" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td class="pad hero">
                <span class="chip">LA Edition</span>
                <div style="height:14px;"></div>
                <h1 class="h1">A cleaner way to stay on top of the market</h1>
                <div style="height:10px;"></div>
                <p class="p muted">Hello {{first_name}}. Here’s what matters this week.</p>
              </td>
            </tr>
            <tr>
              <td class="pad">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="58%" style="vertical-align:top; padding-right:10px;">
                      <div style="padding:16px; border:1px solid #e2e8f0; border-radius:14px;">
                        <div style="font-size:13px; font-weight:900; letter-spacing:0.08em; text-transform:uppercase;">Featured Listings</div>
                        <div style="height:10px;"></div>
                        <img alt="Listing photo" src="https://placehold.co/900x520/png" style="display:block; width:100%; height:auto; border-radius:12px;" />
                        <div style="height:10px;"></div>
                        <p class="p" style="font-weight:900;">987 Sunset Blvd</p>
                        <p class="p muted" style="font-size:13px;">$1,650,000 · 3 bd · 2 ba · Views</p>
                        <div style="height:14px;"></div>
                        <a class="btn" href="#" target="_blank" rel="noopener noreferrer">Tour this listing</a>
                      </div>
                    </td>
                    <td width="42%" style="vertical-align:top; padding-left:10px;">
                      <div style="padding:16px; border:1px solid #e2e8f0; border-radius:14px;">
                        <div style="font-size:13px; font-weight:900; letter-spacing:0.08em; text-transform:uppercase;">Market Pulse</div>
                        <div style="height:10px;"></div>
                        <p class="p muted">Median price</p>
                        <p class="p" style="font-size:20px; font-weight:900;">$812k</p>
                        <div style="height:10px;"></div>
                        <p class="p muted">Days on market</p>
                        <p class="p" style="font-size:20px; font-weight:900;">19</p>
                        <div style="height:10px;"></div>
                        <p class="p muted">New listings</p>
                        <p class="p" style="font-size:20px; font-weight:900;">+7%</p>
                      </div>
                      <div style="height:16px;"></div>
                      <div style="padding:16px; border:1px solid #e2e8f0; border-radius:14px; background:#f8fafc;">
                        <div style="font-size:13px; font-weight:900; letter-spacing:0.08em; text-transform:uppercase;">CTA</div>
                        <div style="height:10px;"></div>
                        <p class="p">Want comps for your neighborhood?</p>
                        <div style="height:12px;"></div>
                        <a class="btn" href="#" target="_blank" rel="noopener noreferrer">Get comps</a>
                      </div>
                    </td>
                  </tr>
                </table>

                <div style="height:18px;"></div>
                <div style="padding:16px; border:1px solid #e2e8f0; border-radius:14px;">
                  <div style="font-size:13px; font-weight:900; letter-spacing:0.08em; text-transform:uppercase;">Market News</div>
                  <div style="height:10px;"></div>
                  <p class="p muted"><a href="#" target="_blank" rel="noopener noreferrer">Headline</a> · One-sentence summary with a source link.</p>
                </div>

                <div style="height:20px;"></div>
                <p class="p muted" style="font-size:12px;">
                  You’re receiving this because you opted in to updates. <a href="#">Unsubscribe</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  },
  {
    id: "chicago",
    name: "Chicago",
    tagline: "Info-dense, structured, skimmable",
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Newsletter</title>
    <style>
      body { margin:0; padding:0; background:#f8fafc; color:#0f172a; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial; }
      a { color:#0f172a; }
      .card { width:680px; max-width:680px; background:#ffffff; border:1px solid #e2e8f0; }
      .pad { padding:22px; }
      .h1 { font-size:24px; line-height:1.25; margin:0; letter-spacing:-0.02em; }
      .kicker { font-size:12px; letter-spacing:0.12em; text-transform:uppercase; font-weight:900; color:#334155; }
      .p { font-size:14px; line-height:1.65; margin:0; color:#0f172a; }
      .muted { color:#64748b; }
      .stat { border:1px solid #e2e8f0; border-radius:12px; padding:12px; }
      @media (max-width: 720px) {
        .card { width:100% !important; border-left:0; border-right:0; }
        .pad { padding:18px !important; }
      }
    </style>
  </head>
  <body>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;">
      <tr>
        <td align="center" style="padding:24px 0;">
          <table role="presentation" class="card" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td class="pad">
                <div class="kicker">Chicago Brief</div>
                <div style="height:10px;"></div>
                <h1 class="h1">Weekly market summary + what to watch</h1>
                <div style="height:8px;"></div>
                <p class="p muted">Hi {{first_name}}. Skimmable by design.</p>

                <div style="height:16px;"></div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="33%" style="padding-right:8px; vertical-align:top;">
                      <div class="stat">
                        <div class="kicker" style="font-size:10px;">Median Price</div>
                        <div style="height:6px;"></div>
                        <div style="font-size:18px; font-weight:900;">$812k</div>
                      </div>
                    </td>
                    <td width="33%" style="padding:0 4px; vertical-align:top;">
                      <div class="stat">
                        <div class="kicker" style="font-size:10px;">Days on Market</div>
                        <div style="height:6px;"></div>
                        <div style="font-size:18px; font-weight:900;">19</div>
                      </div>
                    </td>
                    <td width="33%" style="padding-left:8px; vertical-align:top;">
                      <div class="stat">
                        <div class="kicker" style="font-size:10px;">New Listings</div>
                        <div style="height:6px;"></div>
                        <div style="font-size:18px; font-weight:900;">+7%</div>
                      </div>
                    </td>
                  </tr>
                </table>

                <div style="height:16px;"></div>
                <div class="stat">
                  <div class="kicker" style="font-size:11px;">Market Update</div>
                  <div style="height:8px;"></div>
                  <p class="p">• Inventory is up slightly in key neighborhoods.</p>
                  <p class="p">• Buyers are prioritizing turnkey homes.</p>
                  <p class="p">• Sellers: pricing strategy matters more than staging spend.</p>
                </div>

                <div style="height:16px;"></div>
                <div class="stat">
                  <div class="kicker" style="font-size:11px;">Listings</div>
                  <div style="height:10px;"></div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td width="120" style="vertical-align:top;">
                        <img alt="Listing photo" src="https://placehold.co/240x180/png" width="120" style="display:block; width:120px; height:auto; border-radius:10px;" />
                      </td>
                      <td style="vertical-align:top; padding-left:12px;">
                        <p class="p" style="font-weight:900;">123 Maple St</p>
                        <p class="p muted" style="font-size:13px;">$925,000 · 3 bd · 2 ba</p>
                        <p class="p muted" style="font-size:13px;"><a href="#" target="_blank" rel="noopener noreferrer">View link</a></p>
                      </td>
                    </tr>
                  </table>
                </div>

                <div style="height:18px;"></div>
                <p class="p muted" style="font-size:12px;">
                  You’re receiving this because you opted in to updates. <a href="#">Unsubscribe</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  },
  {
    id: "austin",
    name: "Austin",
    tagline: "Warm modern, calm green accent",
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Newsletter</title>
    <style>
      body { margin:0; padding:0; background:#f1f5f9; color:#0f172a; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial; }
      a { color:#166534; }
      .card { width:680px; max-width:680px; background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; overflow:hidden; }
      .pad { padding:26px; }
      .h1 { font-size:26px; line-height:1.25; margin:0; letter-spacing:-0.02em; }
      .p { font-size:15px; line-height:1.7; margin:0; color:#0f172a; }
      .muted { color:#64748b; }
      .btn { display:inline-block; background:#166534; color:#ffffff !important; text-decoration:none; padding:12px 18px; border-radius:12px; font-weight:900; }
      .soft { background:#f0fdf4; border:1px solid rgba(22,101,52,0.18); border-radius:14px; padding:14px; }
      @media (max-width: 720px) {
        .card { width:100% !important; border-radius:0; border-left:0; border-right:0; }
        .pad { padding:20px !important; }
      }
    </style>
  </head>
  <body>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;">
      <tr>
        <td align="center" style="padding:24px 0;">
          <table role="presentation" class="card" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td class="pad">
                <h1 class="h1">Austin market notes you can skim in 60 seconds</h1>
                <div style="height:10px;"></div>
                <p class="p muted">Hi {{first_name}}. Clean sections, calmer palette.</p>

                <div style="height:16px;"></div>
                <div class="soft">
                  <div style="font-size:13px; font-weight:900; text-transform:uppercase; letter-spacing:0.08em;">Welcome</div>
                  <div style="height:8px;"></div>
                  <p class="p">Here’s what I’m seeing locally, plus a couple of listings you might like.</p>
                </div>

                <div style="height:16px;"></div>
                <div class="soft">
                  <div style="font-size:13px; font-weight:900; text-transform:uppercase; letter-spacing:0.08em;">Listings</div>
                  <div style="height:10px;"></div>
                  <img alt="Listing photo" src="https://placehold.co/900x520/png" style="display:block; width:100%; height:auto; border-radius:12px;" />
                  <div style="height:10px;"></div>
                  <p class="p" style="font-weight:900;">123 Maple St</p>
                  <p class="p muted" style="font-size:13px;">$925,000 · 3 bd · 2 ba</p>
                </div>

                <div style="height:16px;"></div>
                <div class="soft">
                  <div style="font-size:13px; font-weight:900; text-transform:uppercase; letter-spacing:0.08em;">CTA</div>
                  <div style="height:8px;"></div>
                  <p class="p">Want me to watch new listings in your exact price range?</p>
                  <div style="height:12px;"></div>
                  <a class="btn" href="#" target="_blank" rel="noopener noreferrer">Send me your criteria</a>
                </div>

                <div style="height:18px;"></div>
                <p class="p muted" style="font-size:12px;">
                  You’re receiving this because you opted in to updates. <a href="#">Unsubscribe</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  },
];

