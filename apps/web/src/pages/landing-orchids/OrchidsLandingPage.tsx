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
  "education coaching": "/education-chatbot",
  "healthcare clinics": "/healthcare-chatbot",
  "d2c e commerce": "/ecommerce-chatbot",
  "restaurants f b": "/restaurant-chatbot"
};

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

    const root = document.createElement("main");
    root.className = "wagen-home-shadow";
    root.innerHTML = parsedPage.bodyHtml;
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

      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (anchor) {
        const href = anchor.getAttribute("href")?.trim();
        if (href) {
          if (href === "#") {
            event.preventDefault();
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
  }, [navigate, parsedPage]);

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
