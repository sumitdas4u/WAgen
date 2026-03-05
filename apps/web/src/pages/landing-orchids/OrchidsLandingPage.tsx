import { useEffect, useRef } from "react";
import wagenHomeBody from "./wagen-home-body.html?raw";
import wagenHomeCss from "./wagen-home.css?raw";

type TimedStep = {
  el: string;
  delay: number;
  hide?: number;
};

const HERO_SEQUENCE: TimedStep[] = [
  { el: "hc1", delay: 600 },
  { el: "hcTyping", delay: 1200, hide: 1800 },
  { el: "hc2", delay: 1800 },
  { el: "hc3", delay: 2800 },
  { el: "hcTyping", delay: 3400, hide: 4000 },
  { el: "hc4", delay: 4000 },
  { el: "hc5", delay: 5000 },
  { el: "hcTyping", delay: 5600, hide: 6200 },
  { el: "hc6", delay: 6200 }
];

const LEARN_SEQUENCE: TimedStep[] = [
  { el: "lc1", delay: 400 },
  { el: "lc2", delay: 1200 },
  { el: "lc3", delay: 2200 },
  { el: "lc4", delay: 3000 },
  { el: "lc5", delay: 3800 }
];

const HOME_THEME_VARS: ReadonlyArray<readonly [string, string]> = [
  ["--green", "#1DB954"],
  ["--green-dark", "#17a349"],
  ["--green-deep", "#0d6b31"],
  ["--black", "#0F0F0F"],
  ["--near-black", "#1A1A1A"],
  ["--text", "#1A1A1A"],
  ["--muted", "#6B7280"],
  ["--muted-lt", "#9CA3AF"],
  ["--bg", "#FFFFFF"],
  ["--bg2", "#F8FAF8"],
  ["--bg3", "#F0F7F0"],
  ["--border", "#E5E7EB"],
  ["--border-green", "rgba(29,185,84,.2)"],
  ["--wa-green", "#25D366"],
  ["--wa-bubble", "#DCF8C6"],
  ["--wa-bg", "#ECE5DD"]
];

export function OrchidsLandingPage() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const scopedCss = wagenHomeCss
      .replace(/:root/g, ".wagen-home-shadow")
      .replace(/\bhtml\s*\{/g, ".wagen-home-shadow{")
      .replace(/\bbody\s*\{/g, ".wagen-home-shadow{");

    shadowRoot.innerHTML = `
      <style>${scopedCss}</style>
      <main class="wagen-home-shadow">${wagenHomeBody}</main>
    `;

    const root = shadowRoot.querySelector<HTMLElement>(".wagen-home-shadow");
    if (!root) {
      return;
    }
    HOME_THEME_VARS.forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });

    const timerIds: number[] = [];
    const schedule = (callback: () => void, delay: number) => {
      const timerId = window.setTimeout(callback, delay);
      timerIds.push(timerId);
      return timerId;
    };

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("vis");
          }
        });
      },
      { threshold: 0.1 }
    );

    root.querySelectorAll<HTMLElement>(".reveal").forEach((element, index) => {
      element.style.transitionDelay = `${(index % 4) * 0.08}s`;
      revealObserver.observe(element);
    });

    const runHeroChat = () => {
      root.querySelectorAll<HTMLElement>("#heroChat .wb, #heroChat .typing-bubble").forEach((element) => {
        element.classList.remove("show");
      });

      HERO_SEQUENCE.forEach((item) => {
        schedule(() => {
          const element = root.querySelector<HTMLElement>(`#${item.el}`);
          if (element) {
            element.classList.add("show");
          }
        }, item.delay);

        if (item.hide) {
          schedule(() => {
            const element = root.querySelector<HTMLElement>(`#${item.el}`);
            if (element) {
              element.classList.remove("show");
            }
          }, item.hide);
        }
      });

      schedule(runHeroChat, 9000);
    };

    runHeroChat();

    let learnAnimated = false;
    const learnObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || learnAnimated) {
            return;
          }

          learnAnimated = true;
          root.querySelectorAll<HTMLElement>(".chat-msgs .cm, .chat-msgs .cm-lead").forEach((element) => {
            element.classList.remove("show");
          });

          LEARN_SEQUENCE.forEach((item) => {
            schedule(() => {
              const element = root.querySelector<HTMLElement>(`#${item.el}`);
              if (element) {
                element.classList.add("show");
              }
            }, item.delay);
          });
        });
      },
      { threshold: 0.3 }
    );

    const learnVisual = root.querySelector<HTMLElement>(".learn-visual");
    if (learnVisual) {
      learnObserver.observe(learnVisual);
    }

    const clickHandler = (event: Event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const hashLink = event.target.closest<HTMLAnchorElement>('a[href^="#"]');
      if (hashLink) {
        const targetId = hashLink.getAttribute("href")?.slice(1).trim();
        if (targetId) {
          const target = shadowRoot.getElementById(targetId);
          if (target) {
            event.preventDefault();
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }
        }
      }

      const actionElement = event.target.closest<HTMLElement>(
        ".btn-login, .btn-cta, .hero-btns .btn-hero-primary, .hero-btns .btn-hero-secondary, .cta-btns .btn-hero-primary, .btn-wa"
      );

      if (!actionElement) {
        return;
      }

      event.preventDefault();

      if (actionElement.matches(".btn-login")) {
        window.location.assign("/signup");
        return;
      }

      if (actionElement.matches(".hero-btns .btn-hero-secondary")) {
        window.location.assign("/signup?plan=growth");
        return;
      }

      if (actionElement.matches(".btn-wa")) {
        window.open("https://wa.me/919804735837", "_blank", "noopener,noreferrer");
        return;
      }

      window.location.assign("/signup?plan=starter");
    };

    shadowRoot.addEventListener("click", clickHandler);

    return () => {
      shadowRoot.removeEventListener("click", clickHandler);
      revealObserver.disconnect();
      learnObserver.disconnect();
      timerIds.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  return <div ref={hostRef} className="wagen-home-host" style={{ width: "100%", maxWidth: "none", margin: 0, padding: 0 }} />;
}
