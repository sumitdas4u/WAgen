import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import educationChatbotHtml from "../../../home/education-chatbot.html?raw";
import ecommerceChatbotHtml from "../../../home/ecommerce-chatbot.html?raw";
import healthcareChatbotHtml from "../../../home/healthcare-chatbot.html?raw";
import homeHtml from "../../../home/index.html?raw";
import leadCaptureHtml from "../../../home/lead-capture.html?raw";
import pricingHtml from "../../../home/pricing.html?raw";
import realEstateChatbotHtml from "../../../home/real-estate-chatbot.html?raw";
import restaurantChatbotHtml from "../../../home/restaurant-chatbot.html?raw";
import websiteWidgetHtml from "../../../home/website-widget.html?raw";
import whatsappApiHtml from "../../../home/whatsapp-api.html?raw";
import whatsappBotHtml from "../../../home/whatsapp-bot.html?raw";

type ParsedLandingPage = {
  bodyHtml: string;
  inlineScripts: string[];
  stylesheetHrefs: string[];
  title: string | null;
  scopedCss: string;
};

const LANDING_PAGE_PATHS = [
  "/",
  "/pricing",
  "/whatsapp-bot",
  "/website-widget",
  "/whatsapp-api",
  "/lead-capture",
  "/ecommerce-chatbot",
  "/real-estate-chatbot",
  "/education-chatbot",
  "/healthcare-chatbot",
  "/restaurant-chatbot"
] as const;

const LANDING_PAGE_ALIASES: Readonly<Record<string, (typeof LANDING_PAGE_PATHS)[number]>> = {
  "/whatsapp-chatbot-india": "/whatsapp-bot",
  "/whatsapp-ai-bot": "/whatsapp-bot",
  "/whatsapp-agent": "/whatsapp-bot",
  "/lead-capture-chatbot": "/lead-capture",
  "/wati-alternative": "/pricing",
  "/aisensy-alternative": "/pricing",
  "/whatsapp-business-api-india": "/whatsapp-api",
  "/no-code-whatsapp-chatbot": "/",
  "/whatsapp-chatbot-real-estate": "/real-estate-chatbot",
  "/ai-chatbot-india": "/",
  "/whatsapp-chatbot-pricing-india": "/pricing",
  "/official-whatsapp-api": "/whatsapp-api",
  "/whatsapp-green-tick": "/whatsapp-api",
  "/whatsapp-lead-capture": "/lead-capture",
  "/lead-generation-chatbot": "/lead-capture",
  "/cart-abandonment-chatbot": "/ecommerce-chatbot",
  "/d2c-whatsapp-bot": "/ecommerce-chatbot",
  "/whatsapp-chatbot-online-store": "/ecommerce-chatbot",
  "/whatsapp-bot-property-agents": "/real-estate-chatbot",
  "/lead-capture-real-estate": "/real-estate-chatbot",
  "/property-chatbot-india": "/real-estate-chatbot",
  "/whatsapp-chatbot-coaching": "/education-chatbot",
  "/admission-chatbot-india": "/education-chatbot",
  "/student-support-chatbot": "/education-chatbot",
  "/whatsapp-chatbot-clinic": "/healthcare-chatbot",
  "/appointment-booking-chatbot": "/healthcare-chatbot",
  "/hospital-chatbot-india": "/healthcare-chatbot",
  "/whatsapp-chatbot-restaurant": "/restaurant-chatbot",
  "/table-booking-chatbot": "/restaurant-chatbot",
  "/food-delivery-chatbot": "/restaurant-chatbot",
  "/manufacturing-b2b-chatbot": "/lead-capture",
  "/travel-hospitality-chatbot": "/restaurant-chatbot",
  "/finance-insurance-chatbot": "/whatsapp-api",
  "/ai-chatbot-website": "/website-widget",
  "/lead-capture-widget": "/website-widget"
};

const LANDING_PAGE_HTML: Readonly<Record<(typeof LANDING_PAGE_PATHS)[number], string>> = {
  "/": homeHtml,
  "/pricing": pricingHtml,
  "/whatsapp-bot": whatsappBotHtml,
  "/website-widget": websiteWidgetHtml,
  "/whatsapp-api": whatsappApiHtml,
  "/lead-capture": leadCaptureHtml,
  "/ecommerce-chatbot": ecommerceChatbotHtml,
  "/real-estate-chatbot": realEstateChatbotHtml,
  "/education-chatbot": educationChatbotHtml,
  "/healthcare-chatbot": healthcareChatbotHtml,
  "/restaurant-chatbot": restaurantChatbotHtml
};

const LANDING_PAGE_SET = new Set<string>(LANDING_PAGE_PATHS);
const FOOTER_LINK_GROUPS: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  product: [
    ["WhatsApp Bot", "/whatsapp-bot"],
    ["Website Widget", "/website-widget"],
    ["WhatsApp API", "/whatsapp-api"],
    ["Lead Capture", "/lead-capture"],
    ["Pricing", "/pricing"]
  ],
  industries: [
    ["E-commerce", "/ecommerce-chatbot"],
    ["Real Estate", "/real-estate-chatbot"],
    ["Education", "/education-chatbot"],
    ["Healthcare", "/healthcare-chatbot"],
    ["Restaurants", "/restaurant-chatbot"]
  ],
  company: [
    ["Privacy Policy", "/privacy-policy"],
    ["Terms of Service", "/terms-of-service"],
    ["Data Deletion", "/data-deletion"],
    ["Contact Us", "/contact-us"]
  ]
};
const PLACEHOLDER_TEXT_LINKS: Readonly<Record<string, string>> = {
  "whatsapp bot": "/whatsapp-bot",
  "website widget": "/website-widget",
  "whatsapp api": "/whatsapp-api",
  "lead capture": "/lead-capture",
  pricing: "/pricing",
  "real estate": "/real-estate-chatbot",
  education: "/education-chatbot",
  healthcare: "/healthcare-chatbot",
  "e commerce": "/ecommerce-chatbot",
  ecommerce: "/ecommerce-chatbot",
  restaurants: "/restaurant-chatbot",
  "privacy policy": "/privacy-policy",
  privacy: "/privacy-policy",
  "terms of service": "/terms-of-service",
  "data deletion": "/data-deletion",
  contact: "/contact-us",
  "contact us": "/contact-us",
  about: "/contact-us",
  "about us": "/contact-us",
  blog: "/contact-us"
};
const INDUSTRY_CARD_LINKS: Readonly<Record<string, string>> = {
  "real estate": "/real-estate-chatbot",
  "education & coaching": "/education-chatbot",
  "education coaching": "/education-chatbot",
  "healthcare & clinics": "/healthcare-chatbot",
  "healthcare clinics": "/healthcare-chatbot",
  "d2c & e commerce": "/ecommerce-chatbot",
  "d2c e commerce": "/ecommerce-chatbot",
  "restaurants & f&b": "/restaurant-chatbot",
  "restaurants & f b": "/restaurant-chatbot",
  "restaurants f b": "/restaurant-chatbot",
  "manufacturing & b2b": "/manufacturing-b2b-chatbot",
  "manufacturing b2b": "/manufacturing-b2b-chatbot",
  "travel & hospitality": "/travel-hospitality-chatbot",
  "travel hospitality": "/travel-hospitality-chatbot",
  "finance & insurance": "/finance-insurance-chatbot",
  "finance insurance": "/finance-insurance-chatbot"
};
const SHARED_CHROME_CSS = `
.wagen-home-shadow nav.shared-nav{
  position:fixed;top:0;left:0;right:0;z-index:400;
  display:flex;align-items:center;justify-content:space-between;
  padding:0 5%;height:64px;
  background:rgba(255,255,255,.92);backdrop-filter:blur(16px);
  border-bottom:1px solid var(--border,#e5e7eb);
}
.wagen-home-shadow .shared-logo{
  font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;
  font-size:1.35rem;color:var(--black,#0f0f0f);letter-spacing:-.02em;text-decoration:none;
}
.wagen-home-shadow .shared-logo span{color:var(--green,#1DB954);}
.wagen-home-shadow .shared-links{display:flex;gap:28px;list-style:none;align-items:center;}
.wagen-home-shadow .shared-links a{
  color:var(--muted,#6B7280);text-decoration:none;font-size:.9rem;font-weight:500;transition:color .2s;
}
.wagen-home-shadow .shared-links a:hover{color:var(--black,#0f0f0f);}
.wagen-home-shadow .shared-links a.active{color:var(--black,#0f0f0f);font-weight:700;}
.wagen-home-shadow .shared-links .shared-item{position:relative;}
.wagen-home-shadow .shared-links .shared-item>a{display:inline-flex;align-items:center;gap:6px;}
.wagen-home-shadow .shared-links .menu-caret{font-size:.64rem;opacity:.7;}
.wagen-home-shadow .shared-drop{
  position:absolute;top:100%;left:0;z-index:420;
  min-width:220px;background:#fff;border:1px solid var(--border,#e5e7eb);border-radius:12px;
  margin-top:2px;padding:8px;display:none;box-shadow:0 18px 36px rgba(15,15,15,.12);
}
.wagen-home-shadow .shared-drop a{
  display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;
  color:var(--muted,#6B7280);font-size:.86rem;font-weight:600;text-decoration:none;transition:all .2s;
}
.wagen-home-shadow .shared-drop a:hover{background:var(--bg3,#f0f7f0);color:var(--black,#0f0f0f);}
.wagen-home-shadow .shared-drop a.active{background:var(--bg3,#f0f7f0);color:var(--black,#0f0f0f);}
.wagen-home-shadow .shared-drop .shared-ico{display:inline-flex;width:14px;justify-content:center;font-size:.76rem;opacity:.85;}
.wagen-home-shadow .shared-links .shared-item:hover .shared-drop,
.wagen-home-shadow .shared-links .shared-item.open .shared-drop,
.wagen-home-shadow .shared-links .shared-item:focus-within .shared-drop{display:block;}
.wagen-home-shadow .shared-actions{display:flex;gap:10px;align-items:center;}
.wagen-home-shadow .shared-actions .btn-login{
  background:transparent;color:var(--text,#1a1a1a);border:1.5px solid var(--border,#e5e7eb);
  border-radius:8px;padding:8px 18px;font-family:'Plus Jakarta Sans',sans-serif;font-size:.88rem;font-weight:600;cursor:pointer;transition:all .2s;
}
.wagen-home-shadow .shared-actions .btn-login:hover{border-color:var(--green,#1DB954);color:var(--green,#1DB954);}
.wagen-home-shadow .shared-actions .btn-cta{
  background:var(--green,#1DB954);color:#fff;border:none;border-radius:8px;padding:9px 20px;
  font-family:'Plus Jakarta Sans',sans-serif;font-size:.88rem;font-weight:700;cursor:pointer;transition:all .2s;box-shadow:0 2px 12px rgba(29,185,84,.3);
}
.wagen-home-shadow .shared-actions .btn-cta:hover{background:var(--green-dark,#17a349);transform:translateY(-1px);}
.wagen-home-shadow footer.shared-footer{
  background:var(--bg2,#f8faf8);border-top:1px solid var(--border,#e5e7eb);padding:52px 5% 28px;
}
.wagen-home-shadow .shared-footer-top{
  display:flex;justify-content:space-between;flex-wrap:wrap;gap:32px;max-width:1160px;margin:0 auto;
}
.wagen-home-shadow .shared-footer-brand p{
  color:var(--muted,#6B7280);font-size:.83rem;margin-top:8px;max-width:280px;line-height:1.7;
}
.wagen-home-shadow .shared-footer-links{display:flex;gap:44px;flex-wrap:wrap;}
.wagen-home-shadow .shared-footer-col h4{font-weight:700;font-size:.86rem;margin-bottom:12px;}
.wagen-home-shadow .shared-footer-col a{
  display:block;color:var(--muted,#6B7280);text-decoration:none;font-size:.83rem;margin-bottom:8px;transition:color .2s;
}
.wagen-home-shadow .shared-footer-col a:hover{color:var(--green,#1DB954);}
.wagen-home-shadow .shared-footer-bottom{
  max-width:1160px;margin:32px auto 0;padding-top:18px;border-top:1px solid var(--border,#e5e7eb);
  display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;
}
.wagen-home-shadow .shared-footer-bottom p,
.wagen-home-shadow .shared-footer-bottom .made-in{color:var(--muted-lt,#9CA3AF);font-size:.76rem;}
.wagen-home-shadow .shared-seo-links{display:flex;flex-wrap:wrap;gap:5px 14px;max-width:1160px;margin:10px auto 0;}
.wagen-home-shadow .shared-seo-links a{color:var(--muted-lt,#9CA3AF);font-size:.72rem;text-decoration:none;}
.wagen-home-shadow .shared-seo-links a:hover{color:var(--green,#1DB954);}
.wagen-home-shadow[data-page="website-widget"] .phone-wrap .bbl{
  display:inline-block;
  width:auto;
  min-width:0;
  max-width:84%;
  white-space:normal;
  word-break:normal;
  overflow-wrap:break-word;
  writing-mode:horizontal-tb;
}
@media(max-width:960px){
  .wagen-home-shadow .shared-links{display:none;}
}
`;
const SHARED_HEADER_HTML = `
<nav class="shared-nav">
  <a href="/" class="shared-logo logo">Wagen<span>AI</span></a>
  <ul class="shared-links">
    <li><a href="/#features">Features</a></li>
    <li><a href="/#how">How it Works</a></li>
    <li class="shared-item">
      <a href="#">Industries <span class="menu-caret">&#9662;</span></a>
      <div class="shared-drop">
        <a href="/ecommerce-chatbot"><span class="shared-ico">&#128722;</span>E-commerce</a>
        <a href="/real-estate-chatbot"><span class="shared-ico">&#127968;</span>Real Estate</a>
        <a href="/education-chatbot"><span class="shared-ico">&#127891;</span>Education</a>
        <a href="/healthcare-chatbot"><span class="shared-ico">&#127973;</span>Healthcare</a>
        <a href="/restaurant-chatbot"><span class="shared-ico">&#127869;</span>Restaurants</a>
      </div>
    </li>
    <li class="shared-item">
      <a href="#">Channels <span class="menu-caret">&#9662;</span></a>
      <div class="shared-drop">
        <a href="/whatsapp-bot"><span class="shared-ico">&#128241;</span>WhatsApp Bot</a>
        <a href="/website-widget"><span class="shared-ico">&#128172;</span>Website Widget</a>
        <a href="/whatsapp-api"><span class="shared-ico">&#9889;</span>WhatsApp API</a>
        <a href="/lead-capture"><span class="shared-ico">&#127919;</span>Lead Capture</a>
      </div>
    </li>
    <li><a href="/pricing">Pricing</a></li>
  </ul>
  <div class="shared-actions">
    <button class="btn-login">Log In</button>
    <button class="btn-cta">Start Free (QR Mode)</button>
  </div>
</nav>
`;
const SHARED_FOOTER_HTML = `
<footer class="shared-footer">
  <div class="shared-footer-top">
    <div class="shared-footer-brand">
      <a href="/" class="shared-logo logo">Wagen<span>AI</span></a>
      <p>India's most accessible AI chatbot platform - built for SMEs who want to grow without growing their team.</p>
    </div>
    <div class="shared-footer-links">
      <div class="shared-footer-col">
        <h4>Product</h4>
        <a href="/whatsapp-bot">WhatsApp Bot</a>
        <a href="/website-widget">Website Widget</a>
        <a href="/whatsapp-api">WhatsApp API</a>
        <a href="/lead-capture">Lead Capture</a>
        <a href="/pricing">Pricing</a>
      </div>
      <div class="shared-footer-col">
        <h4>Industries</h4>
        <a href="/ecommerce-chatbot">E-commerce</a>
        <a href="/real-estate-chatbot">Real Estate</a>
        <a href="/education-chatbot">Education</a>
        <a href="/healthcare-chatbot">Healthcare</a>
        <a href="/restaurant-chatbot">Restaurants</a>
      </div>
      <div class="shared-footer-col">
        <h4>Company</h4>
        <a href="/privacy-policy">Privacy Policy</a>
        <a href="/terms-of-service">Terms of Service</a>
        <a href="/data-deletion">Data Deletion</a>
        <a href="/contact-us">Contact Us</a>
      </div>
    </div>
  </div>
  <div class="shared-footer-bottom">
    <p>&copy; 2025 WagenAI. All rights reserved.</p>
    <div class="made-in">Proudly Made in India | WhatsApp(TM) is a Meta trademark</div>
  </div>
  <div class="shared-seo-links">
    <a href="/whatsapp-chatbot-india">WhatsApp Chatbot India</a>
    <a href="/whatsapp-ai-bot">WhatsApp AI Bot</a>
    <a href="/whatsapp-agent">WhatsApp Agent</a>
    <a href="/lead-capture-chatbot">Lead Capture Bot</a>
    <a href="/wati-alternative">WATI Alternative</a>
    <a href="/aisensy-alternative">AiSensy Alternative</a>
    <a href="/whatsapp-business-api-india">WhatsApp Business API India</a>
    <a href="/no-code-whatsapp-chatbot">No-Code WhatsApp Chatbot</a>
    <a href="/whatsapp-chatbot-real-estate">WhatsApp Chatbot Real Estate</a>
    <a href="/ai-chatbot-india">AI Chatbot India</a>
  </div>
</footer>
`;

function normalizeLandingPath(pathname: string): string {
  const normalized = pathname.trim().toLowerCase();
  if (!normalized || normalized === "/") {
    return "/";
  }

  const withoutTrailingSlash = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  return LANDING_PAGE_ALIASES[withoutTrailingSlash] ?? withoutTrailingSlash;
}

function escapeIdSelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, "\\$&");
}

function scopeCssForShadowDom(rawCss: string): string {
  return rawCss
    .replace(/:root/g, ".wagen-home-shadow")
    .replace(/\bhtml\s*,\s*body\s*\{/g, ".wagen-home-shadow{")
    .replace(/\bhtml\s*\{/g, ".wagen-home-shadow{")
    .replace(/\bbody\s*\{/g, ".wagen-home-shadow{");
}

function parseLandingPage(html: string): ParsedLandingPage {
  const parsedDocument = new DOMParser().parseFromString(html, "text/html");

  const styleBlocks = Array.from(parsedDocument.querySelectorAll("style")).map((element) => element.textContent ?? "");
  const stylesheetHrefs = Array.from(parsedDocument.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'))
    .map((link) => link.getAttribute("href")?.trim() ?? "")
    .filter((href) => Boolean(href) && /^https?:\/\//i.test(href));

  const scriptCandidates = Array.from(parsedDocument.body.querySelectorAll("script"));
  const inlineScripts = scriptCandidates
    .filter((script) => !script.getAttribute("src"))
    .map((script) => script.textContent ?? "")
    .filter((scriptCode) => scriptCode.trim().length > 0);

  Array.from(parsedDocument.body.querySelectorAll('link[rel="stylesheet"]')).forEach((linkElement) => linkElement.remove());
  scriptCandidates.forEach((script) => script.remove());

  return {
    bodyHtml: parsedDocument.body.innerHTML,
    inlineScripts,
    stylesheetHrefs,
    title: parsedDocument.title ? parsedDocument.title.trim() : null,
    scopedCss: scopeCssForShadowDom(styleBlocks.join("\n"))
  };
}

function normalizeText(value: string): string {
  return value.replace(/[\u00a0]/g, " ").toLowerCase().replace(/[^a-z0-9&+\s]/g, " ").replace(/\s+/g, " ").trim();
}

function replaceColumnLinks(column: HTMLElement, links: ReadonlyArray<readonly [string, string]>): void {
  const existingAnchors = Array.from(column.querySelectorAll<HTMLAnchorElement>("a"));
  existingAnchors.forEach((anchor) => anchor.remove());

  links.forEach(([label, href]) => {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    column.appendChild(link);
  });
}

function updateFooterLinks(root: HTMLElement): void {
  const columnCandidates = root.querySelectorAll<HTMLElement>("footer .footer-col, footer .ft-col");

  columnCandidates.forEach((column) => {
    const heading = column.querySelector<HTMLElement>("h4, h5");
    if (!heading) {
      return;
    }

    const normalizedHeading = normalizeText(heading.textContent ?? "");
    const links = FOOTER_LINK_GROUPS[normalizedHeading];
    if (!links) {
      return;
    }

    replaceColumnLinks(column, links);
  });
}

function connectPlaceholderAnchors(root: HTMLElement): void {
  root.querySelectorAll<HTMLAnchorElement>('a[href="#"]').forEach((anchor) => {
    const targetHref = PLACEHOLDER_TEXT_LINKS[normalizeText(anchor.textContent ?? "")];
    if (targetHref) {
      anchor.setAttribute("href", targetHref);
    }
  });
}

function connectIndustryCards(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(".ind-grid .ind-card").forEach((card) => {
    const label = normalizeText(card.textContent ?? "");
    const route = INDUSTRY_CARD_LINKS[label] ?? "/contact-us";
    card.dataset.route = route;
    card.setAttribute("role", "link");
    card.tabIndex = 0;
  });
}

function connectBrandLinks(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(".logo").forEach((element) => {
    if (element instanceof HTMLAnchorElement) {
      element.setAttribute("href", "/");
      return;
    }

    element.dataset.route = "/";
    element.setAttribute("role", "link");
    element.tabIndex = 0;
    element.style.cursor = "pointer";
  });
}

function applySharedChrome(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(":scope > nav, :scope > footer").forEach((element) => element.remove());

  const headerTemplate = document.createElement("template");
  headerTemplate.innerHTML = SHARED_HEADER_HTML.trim();
  const sharedHeader = headerTemplate.content.firstElementChild;
  if (sharedHeader) {
    root.prepend(sharedHeader);
  }

  const footerTemplate = document.createElement("template");
  footerTemplate.innerHTML = SHARED_FOOTER_HTML.trim();
  const sharedFooter = footerTemplate.content.firstElementChild;
  if (sharedFooter) {
    root.append(sharedFooter);
  }
}

function updateSharedHeaderActiveLinks(root: HTMLElement, currentPath: string): void {
  root.querySelectorAll<HTMLAnchorElement>(".shared-links a[href], .shared-drop a[href]").forEach((link) => {
    link.classList.remove("active");

    const href = link.getAttribute("href")?.trim();
    if (!href || href.startsWith("#")) {
      return;
    }

    try {
      const nextUrl = new URL(href, window.location.origin);
      if (normalizeLandingPath(nextUrl.pathname) === currentPath && !nextUrl.hash) {
        link.classList.add("active");
      }
    } catch {
      // ignore invalid href values
    }
  });
}

function runWebsiteWidgetHeroAnimation(root: HTMLElement, setTimer: typeof window.setTimeout): void {
  if (!root.querySelector("#ww1") || !root.querySelector("#ww2") || !root.querySelector("#ww3")) {
    return;
  }

  const runCycle = () => {
    const bubbleOne = root.querySelector<HTMLElement>("#ww1");
    const bubbleTwo = root.querySelector<HTMLElement>("#ww2");
    const bubbleThree = root.querySelector<HTMLElement>("#ww3");

    if (!bubbleOne || !bubbleTwo || !bubbleThree) {
      return;
    }

    [bubbleOne, bubbleTwo, bubbleThree].forEach((bubble) => bubble.classList.remove("show"));
    bubbleOne.classList.add("show");
    setTimer(() => bubbleTwo.classList.add("show"), 850);
    setTimer(() => bubbleThree.classList.add("show"), 1650);
    setTimer(runCycle, 4200);
  };

  runCycle();
}

export function OrchidsLandingPage() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const landingPath = normalizeLandingPath(location.pathname);
  const pageHtml = LANDING_PAGE_SET.has(landingPath) ? LANDING_PAGE_HTML[landingPath as (typeof LANDING_PAGE_PATHS)[number]] : LANDING_PAGE_HTML["/"];

  const parsedPage = useMemo(() => parseLandingPage(pageHtml), [pageHtml]);

  useEffect(() => {
    if (parsedPage.title) {
      document.title = parsedPage.title;
    }
  }, [parsedPage.title]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = "";

    parsedPage.stylesheetHrefs.forEach((href) => {
      const linkElement = document.createElement("link");
      linkElement.rel = "stylesheet";
      linkElement.href = href;
      shadowRoot.appendChild(linkElement);
    });

    const styleElement = document.createElement("style");
    styleElement.textContent = parsedPage.scopedCss;
    shadowRoot.appendChild(styleElement);

    const sharedStyleElement = document.createElement("style");
    sharedStyleElement.textContent = SHARED_CHROME_CSS;
    shadowRoot.appendChild(sharedStyleElement);

    const root = document.createElement("main");
    root.className = "wagen-home-shadow";
    root.dataset.page = landingPath === "/" ? "home" : landingPath.slice(1);
    root.innerHTML = parsedPage.bodyHtml;
    applySharedChrome(root);
    updateSharedHeaderActiveLinks(root, landingPath);
    connectBrandLinks(root);
    updateFooterLinks(root);
    connectPlaceholderAnchors(root);
    connectIndustryCards(root);
    shadowRoot.appendChild(root);

    const timeouts: number[] = [];
    const intervals: number[] = [];
    const observers: IntersectionObserver[] = [];

    const trackedSetTimeout: typeof window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const id = window.setTimeout(handler, timeout, ...args);
      timeouts.push(id);
      return id;
    }) as typeof window.setTimeout;

    const trackedSetInterval: typeof window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const id = window.setInterval(handler, timeout, ...args);
      intervals.push(id);
      return id;
    }) as typeof window.setInterval;

    class TrackedIntersectionObserver extends IntersectionObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super(callback, options);
        observers.push(this);
      }
    }

    const scopedDocument = {
      body: root,
      createElement: document.createElement.bind(document),
      getElementById: (id: string) => root.querySelector<HTMLElement>(`#${escapeIdSelector(id)}`),
      querySelector: root.querySelector.bind(root),
      querySelectorAll: root.querySelectorAll.bind(root)
    } as unknown as Document;

    parsedPage.inlineScripts.forEach((scriptCode) => {
      try {
        const runScript = new Function(
          "window",
          "document",
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          "IntersectionObserver",
          scriptCode
        );
        runScript(
          window,
          scopedDocument,
          trackedSetTimeout,
          window.clearTimeout.bind(window),
          trackedSetInterval,
          window.clearInterval.bind(window),
          TrackedIntersectionObserver
        );
      } catch (error) {
        console.error("Failed to run landing page script", error);
      }
    });

    const clickHandler = (event: Event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const clickedInsideSharedItem = Boolean(event.target.closest(".shared-item"));
      if (!clickedInsideSharedItem) {
        root.querySelectorAll<HTMLElement>(".shared-item.open").forEach((item) => item.classList.remove("open"));
      }

      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (anchor) {
        const href = anchor.getAttribute("href")?.trim();
        if (href) {
          if (href === "#") {
            event.preventDefault();
            const sharedItem = anchor.closest<HTMLElement>(".shared-item");
            if (sharedItem) {
              const isOpen = sharedItem.classList.contains("open");
              root.querySelectorAll<HTMLElement>(".shared-item.open").forEach((item) => item.classList.remove("open"));
              if (!isOpen) {
                sharedItem.classList.add("open");
              }
            }
            return;
          }

          if (href.startsWith("#")) {
            const targetId = href.slice(1).trim();
            if (targetId) {
              const target = root.querySelector<HTMLElement>(`#${escapeIdSelector(targetId)}`);
              if (target) {
                event.preventDefault();
                target.scrollIntoView({ behavior: "smooth", block: "start" });
                return;
              }
            }
          } else {
            try {
              const nextUrl = new URL(href, window.location.origin);
              if (nextUrl.origin === window.location.origin) {
                event.preventDefault();
                const nextPath = normalizeLandingPath(nextUrl.pathname);
                if (LANDING_PAGE_SET.has(nextPath)) {
                  navigate(`${nextPath}${nextUrl.search}${nextUrl.hash}`, { replace: false });
                  return;
                }
                navigate(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, { replace: false });
                return;
              }
            } catch {
              // ignore invalid href values
            }
          }
        }
      }

      const routedCard = event.target.closest<HTMLElement>("[data-route]");
      if (routedCard?.dataset.route) {
        event.preventDefault();
        navigate(routedCard.dataset.route);
        return;
      }

      const actionElement = event.target.closest<HTMLElement>(
        ".btn-login, .btn-ghost, .btn-nav-ghost, .btn-cta, .btn-nav-cta, .btn-primary, .p-btn, .btn-hero-primary, .btn-hero-secondary, .btn-outline, .btn-outline-sm, .btn-sm, .btn-wa"
      );

      if (!actionElement) {
        return;
      }

      event.preventDefault();

      if (actionElement.matches(".btn-wa")) {
        window.open("https://wa.me/919804735837", "_blank", "noopener,noreferrer");
        return;
      }

      const actionText = normalizeText(actionElement.textContent ?? "");
      if (
        actionElement.matches(".btn-hero-secondary, .btn-outline, .btn-outline-sm, .btn-sm") ||
        actionText.includes("demo") ||
        actionText.includes("talk to sales")
      ) {
        navigate("/contact-us");
        return;
      }

      if (actionElement.matches(".btn-login, .btn-ghost, .btn-nav-ghost") || actionText.includes("log in")) {
        navigate("/signup");
        return;
      }

      if (actionElement.matches(".p-btn")) {
        const planLabel = normalizeText(actionElement.closest<HTMLElement>(".p-card")?.querySelector(".p-name")?.textContent ?? "");
        const plan = planLabel === "growth" ? "growth" : planLabel === "pro" ? "pro" : "starter";
        navigate(`/signup?plan=${plan}`);
        return;
      }

      navigate("/signup?plan=starter");
    };

    shadowRoot.addEventListener("click", clickHandler);

    return () => {
      shadowRoot.removeEventListener("click", clickHandler);
      observers.forEach((observer) => observer.disconnect());
      timeouts.forEach((id) => window.clearTimeout(id));
      intervals.forEach((id) => window.clearInterval(id));
    };
  }, [landingPath, navigate, parsedPage]);

  useEffect(() => {
    const host = hostRef.current;
    const shadowRoot = host?.shadowRoot;
    const root = shadowRoot?.querySelector<HTMLElement>(".wagen-home-shadow");
    if (!root) {
      return;
    }

    if (!location.hash) {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    const targetId = decodeURIComponent(location.hash.slice(1));
    if (!targetId) {
      return;
    }

    const target = root.querySelector<HTMLElement>(`#${escapeIdSelector(targetId)}`);
    if (!target) {
      return;
    }

    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [location.hash, location.pathname]);

  return <div ref={hostRef} className="wagen-home-host" style={{ margin: 0, maxWidth: "none", padding: 0, width: "100%" }} />;
}


