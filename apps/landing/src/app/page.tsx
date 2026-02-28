import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, 
  MessageSquare, 
  Zap, 
  ShieldCheck, 
  Clock, 
  Smartphone, 
  BarChart3, 
  UserCheck, 
  ArrowRight,
  Menu,
  X,
  PlayCircle,
  QrCode,
  BrainCircuit,
  Globe,
  Star
} from "lucide-react";
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from "@/components/ui/accordion";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { ChatAnimation } from "@/components/chat-animation";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md dark:bg-zinc-950/80">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2 font-bold text-2xl tracking-tighter">
            <span className="text-green-600">Wagen</span>AI
          </Link>
          <div className="hidden md:flex gap-6 text-sm font-medium">
            <Link href="#features" className="hover:text-green-600 transition-colors">Why WagenAI</Link>
            <Link href="#how-it-works" className="hover:text-green-600 transition-colors">How It Works</Link>
            <Link href="#pricing" className="hover:text-green-600 transition-colors">Pricing</Link>
            <Link href="#faq" className="hover:text-green-600 transition-colors">FAQs</Link>
          </div>
          <div className="flex items-center gap-4">
            <Button asChild variant="ghost" className="hidden sm:flex">
              <Link href="/signup">Log In</Link>
            </Button>
            <Button asChild className="bg-green-600 hover:bg-green-700 text-white">
              <Link href="/signup">Start Free Trial</Link>
            </Button>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden pt-20 pb-16 md:pt-32 md:pb-24">
          <div className="container mx-auto px-4 md:px-6">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              <div className="flex flex-col gap-6 text-center lg:text-left">
                <Badge className="w-fit mx-auto lg:mx-0 bg-green-100 text-green-700 hover:bg-green-100 border-green-200 py-1 px-3">
                  Now Live: AI Receptionist for Everyone
                </Badge>
                <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl lg:leading-[1.1]">
                  Turn Your WhatsApp Number into a <span className="text-green-600">24/7 AI Receptionist</span> in 2 Minutes
                </h1>
                <p className="mx-auto max-w-[600px] text-lg text-zinc-600 dark:text-zinc-400 lg:mx-0">
                  No API. No business approval. No coding. <br className="hidden sm:inline" />
                  Just scan your WhatsApp QR, train AI, and go live.
                </p>
                <p className="mx-auto max-w-[600px] text-sm text-zinc-500 dark:text-zinc-400 lg:mx-0">
                  Most WhatsApp chatbot tools require Business API approval. WagenAI works instantly with your existing number.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                  <Button asChild size="lg" className="bg-green-600 hover:bg-green-700 text-white h-14 px-8 text-lg font-semibold">
                    <Link href="/signup">Start Free Trial</Link>
                  </Button>
                  <Button size="lg" variant="outline" className="h-14 px-8 text-lg font-semibold gap-2 border-zinc-200">
                    <PlayCircle className="w-5 h-5" /> Watch Demo
                  </Button>
                </div>
                <div className="flex items-center justify-center lg:justify-start gap-4 text-sm text-zinc-500">
                  <div className="flex -space-x-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-8 w-8 rounded-full border-2 border-white bg-zinc-200 dark:border-zinc-950" />
                    ))}
                  </div>
                  <p>Joined by 500+ business owners this week</p>
                </div>
              </div>
                <div className="relative flex justify-center lg:justify-end">
                  <div className="relative w-full max-w-[500px]">
                    <ChatAnimation />
                    {/* Decorative elements */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[120%] w-[120%] bg-green-100/50 rounded-full blur-3xl -z-10" />
                  </div>
                </div>
            </div>
          </div>
        </section>

        {/* Why WagenAI */}
        <section id="features" className="py-24 bg-zinc-50 dark:bg-zinc-900/50">
          <div className="container mx-auto px-4 md:px-6">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">Why WagenAI</h2>
              <p className="text-lg text-zinc-600 dark:text-zinc-400">Instant AI Bot - No Setup Headaches</p>
            </div>
            
            <div className="grid gap-8 md:grid-cols-3">
              <div className="bg-white dark:bg-zinc-950 p-8 rounded-2xl border shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center mb-6">
                  <QrCode className="w-6 h-6 text-green-600" />
                </div>
                <h3 className="text-xl font-bold mb-3">Forget Business APIs</h3>
                <p className="text-zinc-600 dark:text-zinc-400 mb-4">
                  Forget tedious onboarding. Just scan the QR from your phone like WhatsApp Web and your AI assistant is ready.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-600" /> No API costs</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-600" /> No meta approval</li>
                </ul>
              </div>

              <div className="bg-white dark:bg-zinc-950 p-8 rounded-2xl border shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mb-6">
                  <BrainCircuit className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="text-xl font-bold mb-3">Trainable - Your Brand</h3>
                <p className="text-zinc-600 dark:text-zinc-400 mb-4">
                  Teach the AI how to reply. Update your FAQ anytime and let it learn from your existing chats.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-blue-600" /> Add responses your way</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-blue-600" /> Update anytime</li>
                </ul>
              </div>

              <div className="bg-white dark:bg-zinc-950 p-8 rounded-2xl border shadow-sm hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center mb-6">
                  <Clock className="w-6 h-6 text-purple-600" />
                </div>
                <h3 className="text-xl font-bold mb-3">24/7 Smart Replies</h3>
                <p className="text-zinc-600 dark:text-zinc-400 mb-4">
                  Never miss a message again. Auto-respond while you sleep and filter leads automatically.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-purple-600" /> Answer FAQs instantly</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-purple-600" /> Collect lead info</li>
                </ul>
              </div>
            </div>

            <div className="mt-16 bg-white dark:bg-zinc-950 p-8 rounded-3xl border text-center">
              <div className="flex flex-col md:flex-row items-center justify-center gap-8">
                <div className="flex items-center gap-4">
                  <Smartphone className="w-10 h-10 text-green-600" />
                  <div className="text-left">
                    <h4 className="font-bold">Works With Any Number</h4>
                    <p className="text-sm text-zinc-500">Regular or Business number - both supported.</p>
                  </div>
                </div>
                <div className="h-px w-24 bg-zinc-100 md:h-12 md:w-px" />
                <div className="flex items-center gap-4">
                  <Globe className="w-10 h-10 text-blue-600" />
                  <div className="text-left">
                    <h4 className="font-bold">No Regional Restrictions</h4>
                    <p className="text-sm text-zinc-500">Works worldwide, any language supported.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Table */}
        <section className="py-24">
          <div className="container mx-auto px-4 md:px-6">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">Features</h2>
              <p className="text-lg text-zinc-600 dark:text-zinc-400">Simple, Benefit-Driven tools for your business</p>
            </div>
            
            <div className="max-w-4xl mx-auto overflow-hidden rounded-2xl border shadow-sm">
              <Table>
                <TableHeader className="bg-zinc-50 dark:bg-zinc-900">
                  <TableRow>
                    <TableHead className="w-[300px] font-bold">Feature</TableHead>
                    <TableHead className="font-bold">Benefit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { f: "QR Scan Onboarding", b: "Get live in 2 minutes - no tech setup" },
                    { f: "AI Training Module", b: "Tailor replies to your business tone" },
                    { f: "24/7 Auto Reply", b: "Never miss a customer message" },
                    { f: "Smart Context Replies", b: "AI understands intent - not random replies" },
                    { f: "Analytics Dashboard", b: "See how many chats & replies you get" },
                    { f: "Fallback Templates", b: "Ready templates for FAQs & lead form replies" },
                    { f: "No Official API Needed", b: "Easy, affordable & fast" },
                  ].map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{row.f}</TableCell>
                      <TableCell className="text-zinc-600 dark:text-zinc-400">{row.b}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </section>

        {/* How It Works */}
          <section id="how-it-works" className="py-24 bg-green-50 dark:bg-green-950/20">
            <div className="container mx-auto px-4 md:px-6">
              <div className="text-center max-w-3xl mx-auto mb-16">
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">How It Works</h2>
                <p className="text-lg text-zinc-600 dark:text-zinc-400">Four simple steps to automate your WhatsApp</p>
              </div>

              <div className="grid gap-12 lg:grid-cols-2 items-center max-w-6xl mx-auto">
                <div className="space-y-10">
                  {[
                    { step: "1", title: "Scan QR", desc: "Open WhatsApp on phone -> Scan QR -> Connect.", icon: QrCode },
                    { step: "2", title: "Train in Minutes", desc: "Upload FAQs or let AI learn from existing chats.", icon: BrainCircuit },
                    { step: "3", title: "Go Live", desc: "Your WhatsApp now replies automatically - 24x7.", icon: Zap },
                    { step: "4", title: "Improve Over Time", desc: "See performance & refine replies.", icon: BarChart3 },
                  ].map((item, i) => (
                    <div key={i} className="flex gap-6 items-start group">
                      <div className="w-14 h-14 bg-white dark:bg-zinc-950 rounded-2xl border shadow-sm flex items-center justify-center shrink-0 relative z-10 group-hover:bg-green-600 group-hover:text-white transition-all duration-300">
                        <item.icon className="w-7 h-7" />
                        <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-600 text-white rounded-full text-xs flex items-center justify-center font-bold">
                          {item.step}
                        </div>
                      </div>
                      <div>
                        <h3 className="text-xl font-bold mb-2">{item.title}</h3>
                        <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="relative">
                  <div className="relative rounded-3xl overflow-hidden border shadow-2xl bg-white p-3 dark:bg-zinc-900">
                     <Image 
                        src="/onboarding-qr.svg"
                        alt="Scan QR Onboarding"
                        width={800}
                        height={800}
                        className="w-full h-auto rounded-2xl"
                      />
                      <div className="absolute top-8 left-8 bg-green-600 text-white px-4 py-2 rounded-full text-sm font-bold flex items-center gap-3 shadow-lg animate-bounce">
                        <QrCode className="w-4 h-4" /> Step 1: Scan & Connect
                      </div>
                  </div>
                  {/* Decorative background blur */}
                  <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[110%] h-[110%] bg-green-200/40 rounded-full blur-3xl dark:bg-green-900/20" />
                </div>
              </div>
            </div>
          </section>

        {/* Compare */}
        <section className="py-24">
          <div className="container mx-auto px-4 md:px-6">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">Compare with Others</h2>
              <p className="text-lg text-zinc-600 dark:text-zinc-400">See why WagenAI is the easiest choice for your business</p>
            </div>

            <div className="max-w-5xl mx-auto overflow-x-auto">
              <Table className="border rounded-2xl">
                <TableHeader className="bg-zinc-50 dark:bg-zinc-900">
                  <TableRow>
                    <TableHead className="font-bold">Feature</TableHead>
                    <TableHead className="font-bold text-green-600 bg-green-50 dark:bg-green-900/30">WagenAI</TableHead>
                    <TableHead className="font-bold">Joyz.ai</TableHead>
                    <TableHead className="font-bold">QuickReply.ai</TableHead>
                    <TableHead className="font-bold">Official API tools</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { f: "QR-Scan Onboarding", w: true, j: false, q: true, o: false },
                    { f: "Works With Regular Number", w: true, j: false, q: false, o: false },
                    { f: "Train Your AI", w: true, j: true, q: true, o: "Depends" },
                    { f: "No Business Approval", w: true, j: false, q: false, o: false },
                    { f: "2-Minute Setup", w: true, j: false, q: "Partial", o: false },
                    { f: "Cheap / No API Cost", w: true, j: false, q: false, o: false },
                  ].map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium whitespace-nowrap">{row.f}</TableCell>
                      <TableCell className="text-center bg-green-50/50 dark:bg-green-900/10">
                        {row.w === true ? <CheckCircle2 className="w-5 h-5 text-green-600 mx-auto" /> : row.w}
                      </TableCell>
                      <TableCell className="text-center">
                        {row.j === true ? <CheckCircle2 className="w-5 h-5 text-green-600 mx-auto" /> : <X className="w-5 h-5 text-zinc-300 mx-auto" />}
                      </TableCell>
                      <TableCell className="text-center">
                        {row.q === true ? <CheckCircle2 className="w-5 h-5 text-green-600 mx-auto" /> : row.q === "Partial" ? <span className="text-xs font-medium text-orange-500">Partial</span> : <X className="w-5 h-5 text-zinc-300 mx-auto" />}
                      </TableCell>
                      <TableCell className="text-center">
                        {row.o === true ? <CheckCircle2 className="w-5 h-5 text-green-600 mx-auto" /> : row.o === "Depends" ? <span className="text-xs font-medium text-blue-500">Depends</span> : <X className="w-5 h-5 text-zinc-300 mx-auto" />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </section>

        {/* Use Cases */}
        <section className="py-24 bg-zinc-950 text-white">
          <div className="container mx-auto px-4 md:px-6">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">Use Cases</h2>
              <p className="text-lg text-zinc-400">Whatever your business, WagenAI has you covered</p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { title: "Shop Owners", desc: "Reply to product queries instantly.", icon: Smartphone },
                { title: "Restaurants", desc: "Confirm bookings & answer menu FAQs.", icon: Clock },
                { title: "Service Providers", desc: "Collect leads & schedule appointments automatically.", icon: UserCheck },
                { title: "Freelancers", desc: "Handle client questions without missing messages.", icon: MessageSquare },
              ].map((item, i) => (
                <div key={i} className="bg-zinc-900 p-8 rounded-2xl border border-zinc-800 hover:border-green-600/50 transition-colors group">
                  <div className="w-12 h-12 bg-green-600/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-green-600/20 transition-colors">
                    <item.icon className="w-6 h-6 text-green-500" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">{item.title}</h3>
                  <p className="text-zinc-400">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials */}
        <section className="py-24">
          <div className="container mx-auto px-4 md:px-6">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">Customer Testimonials</h2>
            </div>

            <div className="grid gap-8 md:grid-cols-2 max-w-4xl mx-auto">
              {[
                { name: "Priya", role: "Boutique Owner", text: "WagenAI doubled my leads. I do not have to reply at midnight anymore!" },
                { name: "Rahul", role: "Fitness Trainer", text: "Setup was crazy fast. My WhatsApp literally works for me now!" },
              ].map((t, i) => (
                <div key={i} className="bg-white dark:bg-zinc-900 p-8 rounded-2xl border shadow-sm">
                  <div className="flex gap-1 mb-4 text-yellow-400">
                    {[1, 2, 3, 4, 5].map((star) => <Star key={star} className="w-4 h-4 fill-current" />)}
                  </div>
                  <p className="text-lg italic mb-6">"{t.text}"</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-zinc-200" />
                    <div>
                      <div className="font-bold">- {t.name}</div>
                      <div className="text-sm text-zinc-500">{t.role}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-24 bg-zinc-50 dark:bg-zinc-900/50">
          <div className="container mx-auto px-4 md:px-6">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">Pricing</h2>
              <p className="text-lg text-zinc-600 dark:text-zinc-400">Simple, Predictable Plans</p>
            </div>

            <div className="grid gap-8 md:grid-cols-3 max-w-6xl mx-auto">
              {[
                { name: "Starter", price: "499", best: "1 number, basic AI", features: ["1 WhatsApp Number", "Basic AI training", "24/7 Auto-replies", "Email Support"] },
                { name: "Pro", price: "999", best: "Unlimited replies + analytics", featured: true, features: ["1 WhatsApp Number", "Advanced AI training", "Unlimited Replies", "Analytics Dashboard", "Lead Collection"] },
                { name: "Business", price: "1,799", best: "Priority support + templates", features: ["Up to 3 Numbers", "Custom AI Voice/Tone", "Premium Templates", "Priority Chat Support", "API Access (Optional)"] },
              ].map((plan, i) => (
                <div key={i} className={`relative bg-white dark:bg-zinc-950 p-8 rounded-3xl border shadow-sm flex flex-col ${plan.featured ? 'ring-2 ring-green-600 scale-105 z-10' : ''}`}>
                  {plan.featured && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-600 text-white border-none px-4 py-1">Most Popular</Badge>
                  )}
                  <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
                  <p className="text-sm text-zinc-500 mb-6">{plan.best}</p>
                  <div className="flex items-baseline gap-1 mb-8">
                    <span className="text-3xl font-bold">INR {plan.price}</span>
                    <span className="text-zinc-500">/ mo</span>
                  </div>
                  <ul className="space-y-4 mb-8 flex-1">
                    {plan.features.map((f, j) => (
                      <li key={j} className="flex items-start gap-3 text-sm">
                        <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button className={`w-full h-12 text-lg font-semibold ${plan.featured ? 'bg-green-600 hover:bg-green-700 text-white' : ''}`} variant={plan.featured ? 'default' : 'outline'}>
                    Choose {plan.name}
                  </Button>
                </div>
              ))}
            </div>
            
            <div className="mt-12 text-center">
              <Button size="lg" variant="link" className="text-green-600 font-bold text-lg">
                Start Your Free 7-Day Trial Now
              </Button>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="py-24">
          <div className="container mx-auto px-4 md:px-6 max-w-3xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">FAQ</h2>
            </div>
            
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1">
                <AccordionTrigger className="text-left font-bold">Q - Do I need a business number?</AccordionTrigger>
                <AccordionContent>
                  A - No. Any WhatsApp number works. Whether it is a personal number or a Business app number, you can connect it instantly.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger className="text-left font-bold">Q - Can it answer 24/7?</AccordionTrigger>
                <AccordionContent>
                  A - Yes. Your AI replies automatically day and night. It runs on cloud servers.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3">
                <AccordionTrigger className="text-left font-bold">Q - Is training difficult?</AccordionTrigger>
                <AccordionContent>
                  A - No. We provide templates and auto-train from chat history.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-4">
                <AccordionTrigger className="text-left font-bold">Q - Will I get banned by WhatsApp?</AccordionTrigger>
                <AccordionContent>
                  A - We use managed session handling similar to WhatsApp Web. Avoid spam-like usage.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </section>

        {/* Support Section */}
        <section className="py-24 bg-green-600 text-white">
          <div className="container mx-auto px-4 md:px-6 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">Need Help Setting Up?</h2>
            <p className="text-xl opacity-90 mb-10 max-w-2xl mx-auto">We're here to help you turn your WhatsApp into a money-making machine.</p>
            
            <div className="flex flex-col sm:flex-row gap-6 justify-center">
              <Link href="mailto:support@wagenai.com" className="bg-white text-green-600 px-8 py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-zinc-100 transition-colors">
                Email Support
              </Link>
              <Link href="/signup" className="bg-zinc-900 text-white px-8 py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-black transition-colors border border-green-500/30">
                Chat Support
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-12 bg-zinc-50 dark:bg-zinc-950">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <Link href="/" className="flex items-center gap-2 font-bold text-2xl tracking-tighter mb-6">
                <span className="text-green-600">Wagen</span>AI
              </Link>
              <p className="text-sm text-zinc-500">
                Turn your phone into an AI receptionist. <br />
                Instant. No API. No Approval.
              </p>
            </div>
            <div>
              <h4 className="font-bold mb-6">Product</h4>
              <ul className="space-y-4 text-sm text-zinc-500">
                <li><Link href="#features" className="hover:text-green-600 transition-colors">Features</Link></li>
                <li><Link href="#pricing" className="hover:text-green-600 transition-colors">Pricing</Link></li>
                <li><Link href="#how-it-works" className="hover:text-green-600 transition-colors">How it Works</Link></li>
                <li><Link href="/demo" className="hover:text-green-600 transition-colors">Watch Demo</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-6">Company</h4>
              <ul className="space-y-4 text-sm text-zinc-500">
                <li><Link href="/about" className="hover:text-green-600 transition-colors">About</Link></li>
                <li><Link href="/privacy" className="hover:text-green-600 transition-colors">Privacy</Link></li>
                <li><Link href="/terms" className="hover:text-green-600 transition-colors">Terms</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-6">Contact</h4>
              <ul className="space-y-4 text-sm text-zinc-500">
                <li><Link href="mailto:support@wagenai.com" className="hover:text-green-600 transition-colors">support@wagenai.com</Link></li>
                <li><Link href="#" className="hover:text-green-600 transition-colors">Twitter</Link></li>
                <li><Link href="#" className="hover:text-green-600 transition-colors">LinkedIn</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t flex flex-col md:flex-row justify-between gap-4 text-sm text-zinc-500">
            <p>© 2026 WagenAI. All rights reserved.</p>
            <div className="flex gap-6">
              <Link href="/terms" className="hover:text-green-600 transition-colors">Terms & Privacy</Link>
              <Link href="/contact" className="hover:text-green-600 transition-colors">Contact</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}



