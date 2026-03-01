import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  BarChart3,
  Bot,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  GitBranch,
  LineChart,
  Megaphone,
  MessageSquare,
  PlugZap,
  QrCode,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChatAnimation } from "@/components/chat-animation";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const starterHighlights = [
  "Setup in 2 minutes",
  "No approval required",
  "Train AI easily",
  "Affordable",
];

const scaleHighlights = [
  "Official WhatsApp Business API",
  "No ban risk",
  "High message volume",
  "Multi-agent support",
  "CRM integrations",
];

const qrHowSteps = [
  "Open WhatsApp on phone and scan QR to connect.",
  "Train AI with FAQs, URLs, or docs in minutes.",
  "Go live and auto-reply to customer chats 24x7.",
  "Improve responses over time from real conversations.",
];

const apiHowSteps = [
  "Create Meta Business account and verify business details.",
  "Get WhatsApp Business API approval and connect number.",
  "Set templates, automations, and routing rules.",
  "Scale with stable high-volume messaging and integrations.",
];

const platformFeatures = [
  { title: "Embedded Signup", desc: "Onboard customers securely using an integrated signup flow.", icon: UserPlus },
  { title: "Integrated Business Chat", desc: "Communicate with customers directly using official channels.", icon: MessageSquare },
  { title: "QR Code", desc: "Generate custom QR codes to let users start conversations fast.", icon: QrCode },
  { title: "Chat-Bot", desc: "Provide 24/7 AI-powered customer support automation.", icon: Bot },
  { title: "Manage Templates", desc: "Create and manage approved message templates from one dashboard.", icon: FileText },
  { title: "Flow Maker", desc: "Design automated messaging workflows with drag-and-drop flow logic.", icon: Workflow },
  { title: "API Integration", desc: "Integrate third-party systems securely with standard REST APIs.", icon: PlugZap },
  { title: "Live Analysis", desc: "Monitor real-time performance and engagement insights.", icon: LineChart },
  { title: "Assign Agents", desc: "Route chats to team members with assignment controls.", icon: Users },
  { title: "Campaigns", desc: "Run compliant customer messaging campaigns at scale.", icon: Megaphone },
  { title: "AI Chatbot", desc: "Automate customer conversations with AI-assisted replies.", icon: Sparkles },
  { title: "Chat Report", desc: "Access detailed conversation and agent performance reports.", icon: ClipboardList },
  { title: "Booking Form", desc: "Allow customers to request appointments from chat.", icon: CalendarCheck },
  { title: "Appointments Flows", desc: "Build structured appointment follow-up and reminder flows.", icon: GitBranch },
  { title: "Google Sheets Integrate", desc: "Auto-export data to Google Sheets and connected tools.", icon: FileSpreadsheet },
];

const comparisonRows = [
  ["Setup Time", "2 Minutes", "1-2 Days"],
  ["WhatsApp Approval", "Not Required", "Required"],
  ["Ban Risk", "Medium", "Very Low"],
  ["Bulk Messaging", "Limited", "Full Support"],
  ["Multi Agents", "No", "Yes"],
  ["Automation", "Basic", "Advanced"],
  ["Ideal For", "Testing", "Growing Businesses"],
];

const useCases = [
  "Restaurants",
  "E-commerce",
  "Coaching Institutes",
  "Clinics",
  "Real Estate",
  "Agencies",
];

const faqItems = [
  {
    q: "Is QR Mode safe?",
    a: "It is ideal for testing and small use.",
  },
  {
    q: "Is Official API better?",
    a: "Yes. It is better for scaling and high message volume.",
  },
  {
    q: "Can I upgrade later?",
    a: "Yes. You can upgrade from QR Mode to Official API Mode anytime.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-900">
      <nav className="sticky top-0 z-50 w-full border-b bg-white/85 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
          <Link href="/" className="flex items-center gap-1 text-2xl font-extrabold tracking-tight">
            <span className="text-emerald-600">Wagen</span>AI
          </Link>
          <div className="hidden items-center gap-6 text-sm font-medium md:flex">
            <Link href="#features" className="transition-colors hover:text-emerald-600">
              Features
            </Link>
            <Link href="#how-it-works" className="transition-colors hover:text-emerald-600">
              How It Works
            </Link>
            <Link href="#pricing" className="transition-colors hover:text-emerald-600">
              Pricing
            </Link>
            <Link href="#faq" className="transition-colors hover:text-emerald-600">
              FAQs
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <Link href="/signup">Log In</Link>
            </Button>
            <Button asChild className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Link href="/signup">Start Free (QR Mode)</Link>
            </Button>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        <section className="relative overflow-hidden bg-zinc-100 py-20 md:py-28">
          <div className="container mx-auto px-4 md:px-6">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div className="text-center lg:text-left">
                <Badge className="mx-auto mb-5 w-fit border-emerald-200 bg-emerald-100 px-4 py-1 text-emerald-700 hover:bg-emerald-100 lg:mx-0">
                  WhatsApp AI Automation Platform for Startups, SMBs and Enterprises
                </Badge>
                <h1 className="text-4xl font-black tracking-tight sm:text-5xl md:text-6xl lg:leading-[1.06]">
                  Automate Your WhatsApp with AI - From <span className="text-emerald-600">Instant Setup</span> to <span className="text-emerald-600">Official API Scale</span>
                </h1>
                <p className="mx-auto mt-6 max-w-[620px] text-lg text-zinc-600 lg:mx-0">
                  Start instantly with QR mode. Upgrade anytime to official WhatsApp Business API for large-scale automation.
                </p>
                <p className="mx-auto mt-4 max-w-[620px] text-sm text-zinc-500 lg:mx-0">
                  QR mode is ideal for testing and early-stage businesses. For long-term growth, we recommend Official API mode.
                </p>
                <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row lg:justify-start">
                  <Button asChild size="lg" className="h-14 bg-emerald-600 px-8 text-base text-white hover:bg-emerald-700">
                    <Link href="/signup">Start Free (QR Mode)</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" className="h-14 border-sky-500 px-8 text-base text-sky-700 hover:bg-sky-50">
                    <Link href="/signup">Get Official WhatsApp API</Link>
                  </Button>
                </div>
                <div className="mt-7 flex items-center justify-center gap-4 text-sm text-zinc-500 lg:justify-start">
                  <div className="flex -space-x-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-8 w-8 rounded-full border-2 border-white bg-zinc-300" />
                    ))}
                  </div>
                  <p>Joined by 500+ business owners this week</p>
                </div>
              </div>
              <div className="relative flex justify-center lg:justify-end">
                <div className="relative w-full max-w-[520px]">
                  <ChatAnimation />
                  <div className="absolute -inset-6 -z-10 rounded-full bg-emerald-200/50 blur-3xl" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="modes" className="py-20 md:py-24">
          <div className="container mx-auto px-4 md:px-6">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Choose Your Mode</h2>
              <p className="mt-3 text-lg text-zinc-600">
                Start instantly with QR mode and scale confidently with Official API mode.
              </p>
            </div>
            <div className="grid gap-8 lg:grid-cols-2">
              <article className="rounded-3xl border border-emerald-200 bg-white p-8 shadow-sm">
                <div className="mb-5 flex items-center gap-3">
                  <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-600">
                    <QrCode className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium uppercase tracking-wide text-emerald-700">Mode 1</p>
                    <h3 className="text-2xl font-bold">Instant QR Setup (Starter)</h3>
                  </div>
                </div>
                <p className="text-zinc-600">Perfect for testing and small businesses.</p>
                <ul className="mt-6 space-y-3">
                  {starterHighlights.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-zinc-700">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  Best for limited usage and testing.
                </p>
                <p className="mt-6 text-3xl font-black">₹99<span className="text-base font-medium text-zinc-500">/month</span></p>
              </article>

              <article className="rounded-3xl border border-sky-200 bg-white p-8 shadow-sm">
                <div className="mb-5 flex items-center gap-3">
                  <div className="rounded-xl bg-sky-100 p-2.5 text-sky-600">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium uppercase tracking-wide text-sky-700">Mode 2</p>
                    <h3 className="text-2xl font-bold">Official WhatsApp API (Scale)</h3>
                  </div>
                </div>
                <p className="text-zinc-600">For serious business automation.</p>
                <ul className="mt-6 space-y-3">
                  {scaleHighlights.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-zinc-700">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-sky-600" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-3xl font-black">₹249<span className="text-base font-medium text-zinc-500">/month</span></p>
                <p className="mt-1 text-sm font-medium text-zinc-600">or ₹2000/year</p>
              </article>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="bg-emerald-50/60 py-20 md:py-24">
          <div className="container mx-auto px-4 md:px-6">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">How It Works</h2>
              <p className="mt-3 text-lg text-zinc-600">Follow the setup flow that matches your business stage.</p>
            </div>

            <div className="grid gap-8 lg:grid-cols-2">
              <article className="rounded-3xl border border-emerald-200 bg-white p-7 shadow-sm">
                <h3 className="text-2xl font-bold">Mode 1 - Instant QR Setup</h3>
                <p className="mt-2 text-zinc-600">Fast onboarding for testing and quick launch.</p>
                <ol className="mt-6 space-y-4">
                  {qrHowSteps.map((step, index) => (
                    <li key={step} className="flex items-start gap-3">
                      <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-emerald-600 text-center text-xs font-bold leading-6 text-white">
                        {index + 1}
                      </div>
                      <p className="text-sm text-zinc-700">{step}</p>
                    </li>
                  ))}
                </ol>
                <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                  <Image src="/onboarding-qr.svg" alt="QR onboarding" width={900} height={700} className="h-auto w-full rounded-xl" />
                </div>
              </article>

              <article className="rounded-3xl border border-sky-200 bg-white p-7 shadow-sm">
                <h3 className="text-2xl font-bold">Mode 2 - Official API Setup</h3>
                <p className="mt-2 text-zinc-600">Stable and scalable setup for long-term growth.</p>
                <ol className="mt-6 space-y-4">
                  {apiHowSteps.map((step, index) => (
                    <li key={step} className="flex items-start gap-3">
                      <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-sky-600 text-center text-xs font-bold leading-6 text-white">
                        {index + 1}
                      </div>
                      <p className="text-sm text-zinc-700">{step}</p>
                    </li>
                  ))}
                </ol>
                <div className="mt-7 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-sky-200 bg-white p-3 text-sm font-medium text-zinc-700">Business Verification</div>
                    <div className="rounded-xl border border-sky-200 bg-white p-3 text-sm font-medium text-zinc-700">API Approval</div>
                    <div className="rounded-xl border border-sky-200 bg-white p-3 text-sm font-medium text-zinc-700">Template & Flow Setup</div>
                    <div className="rounded-xl border border-sky-200 bg-white p-3 text-sm font-medium text-zinc-700">Go Live at Scale</div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section id="features" className="py-20 md:py-24">
          <div className="container mx-auto px-4 md:px-6">
            <div className="mx-auto mb-12 max-w-4xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Key Features of <span className="text-emerald-600">Our Platform</span>
              </h2>
              <p className="mt-3 text-lg text-zinc-600">
                Enable smarter customer communication with business automation, seamless workflows, and measurable insights.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {platformFeatures.map((item) => (
                <article key={item.title} className="relative rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
                  <div className="absolute right-3 top-3 rounded-md bg-emerald-600 p-1 text-white">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </div>
                  <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-zinc-100 text-emerald-600">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-xl font-bold">{item.title}</h3>
                  <p className="mt-2 text-sm text-zinc-600">{item.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-zinc-200 bg-zinc-950 py-20 text-white md:py-24">
          <div className="container mx-auto px-4 md:px-6">
            <div className="mx-auto max-w-4xl rounded-3xl border border-zinc-700 bg-zinc-900 p-8 md:p-10">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Why Official API Is Important</h2>
              <p className="mt-5 text-zinc-300">
                Many tools only use QR connection. QR connection can disconnect, is not reliable for scale, and carries risk of number restriction.
              </p>
              <div className="mt-7 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4">
                  <p className="font-semibold text-emerald-300">WagenAI offers:</p>
                  <ul className="mt-2 space-y-2 text-sm text-emerald-50">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      Instant QR for testing
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      Official API for long-term growth
                    </li>
                  </ul>
                </div>
                <div className="rounded-2xl border border-zinc-700 bg-zinc-950/70 p-4">
                  <p className="font-semibold text-zinc-100">Transparent recommendation:</p>
                  <p className="mt-2 text-sm text-zinc-300">
                    QR mode is ideal for testing and early-stage businesses. For long-term growth, we recommend upgrading to Official API mode.
                  </p>
                </div>
              </div>
              <p className="mt-6 font-semibold text-zinc-100">You choose what fits your business.</p>
            </div>
          </div>
        </section>

        <section id="comparison" className="py-20 md:py-24">
          <div className="container mx-auto px-4 md:px-6">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Feature Comparison Table</h2>
            </div>
            <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-zinc-200 bg-white">
              <Table>
                <TableHeader className="bg-zinc-100">
                  <TableRow>
                    <TableHead className="font-bold text-zinc-900">Feature</TableHead>
                    <TableHead className="font-bold text-emerald-700">QR Mode</TableHead>
                    <TableHead className="font-bold text-sky-700">Official API Mode</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparisonRows.map((row) => (
                    <TableRow key={row[0]}>
                      <TableCell className="font-medium">{row[0]}</TableCell>
                      <TableCell>{row[1]}</TableCell>
                      <TableCell>{row[2]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </section>

        <section className="bg-zinc-100 py-20 md:py-24">
          <div className="container mx-auto px-4 md:px-6">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Use Cases</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {useCases.map((item) => (
                <div key={item} className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                  <p className="text-base font-semibold text-zinc-800">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="py-20 md:py-24">
          <div className="container mx-auto px-4 md:px-6">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Pricing</h2>
            </div>
            <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
              <article className="rounded-3xl border border-emerald-200 bg-white p-8 shadow-sm">
                <h3 className="text-2xl font-bold">Starter (QR Mode)</h3>
                <p className="mt-2 text-zinc-600">Instant AI Bot Setup</p>
                <p className="mt-8 text-4xl font-black">₹99<span className="text-base font-medium text-zinc-500">/month</span></p>
                <Button asChild className="mt-8 h-12 w-full bg-emerald-600 text-white hover:bg-emerald-700">
                  <Link href="/signup">Start Free (QR Mode)</Link>
                </Button>
              </article>

              <article className="rounded-3xl border border-sky-200 bg-white p-8 shadow-sm">
                <h3 className="text-2xl font-bold">Growth (API Mode)</h3>
                <p className="mt-2 text-zinc-600">Official WhatsApp API + AI Automation</p>
                <p className="mt-8 text-4xl font-black">₹249<span className="text-base font-medium text-zinc-500">/month</span></p>
                <p className="mt-2 text-sm font-semibold text-zinc-700">or ₹2000/year</p>
                <Button asChild variant="outline" className="mt-8 h-12 w-full border-sky-500 text-sky-700 hover:bg-sky-50">
                  <Link href="/signup">Get Official WhatsApp API</Link>
                </Button>
              </article>
            </div>
          </div>
        </section>

        <section id="faq" className="border-t border-zinc-200 py-20 md:py-24">
          <div className="container mx-auto max-w-3xl px-4 md:px-6">
            <div className="mb-10 text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">FAQ</h2>
            </div>
            <Accordion type="single" collapsible className="w-full rounded-2xl border border-zinc-200 bg-white px-6">
              {faqItems.map((item, index) => (
                <AccordionItem key={item.q} value={`item-${index + 1}`}>
                  <AccordionTrigger className="text-left text-base font-semibold">{item.q}</AccordionTrigger>
                  <AccordionContent className="text-zinc-600">{item.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 bg-white py-10">
        <div className="container mx-auto flex flex-col gap-4 px-4 md:px-6 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-zinc-600">© 2026 WagenAI. WhatsApp AI Automation Platform for Startups, SMBs and Enterprises.</p>
          <div className="flex gap-5 text-sm text-zinc-600">
            <Link href="#features" className="hover:text-emerald-600">
              Features
            </Link>
            <Link href="#pricing" className="hover:text-emerald-600">
              Pricing
            </Link>
            <Link href="#faq" className="hover:text-emerald-600">
              FAQ
            </Link>
            <a href="/privacy-policy" className="hover:text-emerald-600">
              Privacy Policy
            </a>
            <a href="/terms-of-service" className="hover:text-emerald-600">
              Terms of Service
            </a>
            <a href="/contact-us" className="hover:text-emerald-600">
              Contact Us
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
