#!/usr/bin/env python3
"""Render the EKS deployment diagrams as SVG (standard library only).

    python3 deploy/eks/diagrams/build_diagrams.py

Writes deploy/eks/diagrams/svg/*.svg. Each diagram has an editable Mermaid equivalent beside
this script (*.mmd); when a component or call changes, update both. The visual vocabulary is the
same as the jithendar.com RoboShop article diagrams (www/docs/diagrams/roboshop-ai-microservices).
"""
from html import escape
from pathlib import Path

OUT = Path(__file__).resolve().parent / "svg"
FONT = "Inter, 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif"

KINDS = {  # fill, stroke, title colour
    "client": ("#f8fafc", "#334155", "#0f172a"),
    "edge": ("#eef2ff", "#4338ca", "#1e1b4b"),
    "svc": ("#ecfdf5", "#047857", "#064e3b"),
    "ai": ("#f5f3ff", "#6d28d9", "#2e1065"),
    "store": ("#fffbeb", "#b45309", "#451a03"),
    "bus": ("#fff1f2", "#be123c", "#4c0519"),
    "external": ("#f1f5f9", "#64748b", "#0f172a"),
    "obs": ("#f0fdf4", "#15803d", "#14532d"),
    "control": ("#fdf4ff", "#a21caf", "#4a044e"),
    "aws": ("#fff7ed", "#c2410c", "#431407"),
}
ARROWS = {  # stroke, width, dash
    "sync": ("#475569", 1.8, None),
    "async": ("#be123c", 3.2, None),
    "telemetry": ("#15803d", 1.8, "6 4"),
    "control": ("#a21caf", 1.8, "2 4"),
    "deny": ("#dc2626", 1.8, "6 4"),
}


class Svg:
    def __init__(self, width, height, title, desc):
        self.w, self.h, self.parts = width, height, []
        self.title, self.desc = title, desc

    def add(self, s):
        self.parts.append(s)

    def text(self, x, y, s, size=13, weight=400, fill="#334155", anchor="middle", halo=False, italic=False):
        extra = ' paint-order="stroke" stroke="#ffffff" stroke-width="5" stroke-linejoin="round"' if halo else ""
        style = ' font-style="italic"' if italic else ""
        self.add(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" '
                 f'text-anchor="{anchor}"{style}{extra}>{escape(s)}</text>')

    def heading(self, title, sub):
        self.text(24, 40, title, 20, 700, "#0f172a", "start")
        self.text(24, 62, sub, 12.5, 400, "#475569", "start")

    def band(self, x, y, w, h, label, sub=None, dashed=False, stroke="#e2e8f0", fill="#f8fafc"):
        dash = ' stroke-dasharray="6 4"' if dashed else ""
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{fill}" stroke="{stroke}" stroke-width="1.4"{dash}/>')
        self.text(x + 14, y + 20, label.upper(), 11, 700, "#475569", "start")
        if sub:
            self.text(x + 14, y + 36, sub, 11.5, 400, "#64748b", "start")

    def node(self, x, y, w, h, kind, title, lines=(), optional=False, bold=False):
        fill, stroke, ink = KINDS[kind]
        dash = ' stroke-dasharray="6 4"' if optional else ""
        sw = 2.4 if bold else 1.6
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{dash}/>')
        cx = x + w / 2
        ty = y + (h - 19 * (1 + len(lines))) / 2 + 15
        self.text(cx, ty, title, 14, 700, ink)
        for i, line in enumerate(lines):
            self.text(cx, ty + 19 * (i + 1), line, 12, 400, "#334155")
        if optional:
            self.add(f'<rect x="{x + w - 64}" y="{y - 9}" width="56" height="18" rx="9" fill="#ffffff" stroke="{stroke}" stroke-width="1.2"/>')
            self.text(x + w - 36, y + 4, "optional", 10.5, 600, stroke, italic=True)

    def cylinder(self, x, y, w, h, kind, title, lines=()):
        fill, stroke, ink = KINDS[kind]
        e = 8
        self.add(f'<path d="M{x},{y + e} a{w / 2},{e} 0 0 0 {w},0 a{w / 2},{e} 0 0 0 {-w},0 v{h - 2 * e} '
                 f'a{w / 2},{e} 0 0 0 {w},0 v{-(h - 2 * e)}" fill="{fill}" stroke="{stroke}" stroke-width="1.6"/>')
        cx = x + w / 2
        ty = y + e + (h - e - 19 * (1 + len(lines))) / 2 + 14
        self.text(cx, ty, title, 13.5, 700, ink)
        for i, line in enumerate(lines):
            self.text(cx, ty + 19 * (i + 1), line, 11.5, 400, "#334155")

    def arrow(self, pts, kind="sync", label=None, at=None, anchor="middle", both=False):
        stroke, width, dash = ARROWS[kind]
        d = "M" + " L".join(f"{px},{py}" for px, py in pts)
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        start = f' marker-start="url(#arrow-{kind})"' if both else ""
        self.add(f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{width}"{dash_attr} '
                 f'stroke-linejoin="round"{start} marker-end="url(#arrow-{kind})"/>')
        if label:
            lx, ly = at
            for i, part in enumerate(label.split("\n")):
                self.text(lx, ly + i * 14, part, 11.5, 600, "#1e293b", anchor, halo=True)

    def step(self, x, y, n):
        self.add(f'<circle cx="{x}" cy="{y}" r="10" fill="#0f172a"/>')
        self.text(x, y + 4.2, str(n), 11.5, 700, "#ffffff")

    def note(self, x, y, lines, size=11.5, fill="#64748b"):
        for i, line in enumerate(lines):
            self.text(x, y + i * 16, line, size, 400, fill, "start")

    def legend(self, x, y, items):
        cx = x
        for kind, label in items:
            if kind in ARROWS:
                stroke, width, dash = ARROWS[kind]
                dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
                self.add(f'<path d="M{cx},{y} L{cx + 28},{y}" stroke="{stroke}" stroke-width="{width}"{dash_attr} marker-end="url(#arrow-{kind})"/>')
                cx += 38
            elif kind == "optional":
                self.add(f'<rect x="{cx}" y="{y - 8}" width="24" height="16" rx="4" fill="#ffffff" stroke="#64748b" stroke-width="1.4" stroke-dasharray="4 3"/>')
                cx += 32
            else:
                fill, stroke, _ = KINDS[kind]
                self.add(f'<rect x="{cx}" y="{y - 8}" width="24" height="16" rx="8" fill="{fill}" stroke="{stroke}" stroke-width="1.4"/>')
                cx += 32
            self.text(cx, y + 4.5, label, 12, 500, "#334155", "start")
            cx += len(label) * 6.7 + 20

    def render(self, name):
        markers = "".join(
            f'<marker id="{name}-arrow-{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="{12 if k == "async" else 9}" '
            f'markerHeight="{12 if k == "async" else 9}" orient="auto-start-reverse" markerUnits="userSpaceOnUse">'
            f'<path d="M0,0 L10,5 L0,10 z" fill="{v[0]}"/></marker>'
            for k, v in ARROWS.items()
        )
        body = "\n".join(self.parts).replace('url(#arrow-', f'url(#{name}-arrow-')
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" width="{self.w}" height="{self.h}" '
            f'role="img" aria-labelledby="{name}-title {name}-desc" font-family="{FONT}">\n'
            f'<title id="{name}-title">{escape(self.title)}</title>\n<desc id="{name}-desc">{escape(self.desc)}</desc>\n'
            f'<defs>{markers}</defs>\n<rect width="100%" height="100%" rx="18" fill="#ffffff"/>\n'
            + body + "\n</svg>\n"
        )
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / f"{name}.svg").write_text(svg)


# 1 ─────────────────────────────────────────────────────────────────────────────────────────────
def system_context():
    s = Svg(720, 1010, "RoboShop AI on EKS: services and data ownership",
            "Browsers reach the shop through an AWS Network Load Balancer and the Istio ingress gateway, which "
            "forwards to the web NGINX service. NGINX sends API calls to ai-gateway, assistant calls to Moks and "
            "currency calls to currency-service. ai-gateway calls user, catalogue, cart, payment, shipping and "
            "currency services and the optional Moks engine; it owns the order ledger and outbox. A private MCP "
            "server, reachable only by port-forward, calls the gateway with the caller's session. Paid orders flow "
            "from the outbox through RabbitMQ to shipping-worker and kafka-bridge. Each service is labelled with "
            "the data store it owns.")
    s.heading("Services and data ownership", "Who calls whom, and which store each service owns.")

    s.band(12, 80, 696, 92, "Clients")
    s.node(40, 104, 200, 56, "client", "Browser", ["storefront + assistant widget"])
    s.node(480, 104, 200, 56, "client", "MCP client", ["kubectl port-forward only"])

    s.band(12, 184, 696, 92, "Edge (public)")
    s.node(40, 208, 150, 56, "aws", "AWS NLB", ["TCP 80/443"])
    s.node(230, 208, 200, 56, "edge", "Istio ingress gateway", ["TLS, routing"])
    s.node(470, 208, 120, 56, "edge", "web", ["NGINX"])
    s.arrow([(140, 160), (115, 160), (115, 208)])
    s.arrow([(190, 236), (230, 236)])
    s.arrow([(430, 236), (470, 236)])

    s.band(12, 288, 696, 150, "Orchestration")
    s.node(40, 320, 150, 92, "ai", "moks", ["assistant engine", "no data store"], optional=True)
    s.node(250, 320, 220, 92, "svc", "ai-gateway", ["API, authz, ledger,", "outbox (JSON or Postgres)"], bold=True)
    s.node(530, 320, 150, 92, "ai", "mcp-server", ["private MCP tools"])
    s.arrow([(560, 264), (560, 302), (440, 302), (440, 320)], label="/api", at=(568, 296), anchor="start")
    s.arrow([(490, 264), (490, 284), (160, 284), (160, 320)], label="/moks", at=(300, 279))
    s.arrow([(250, 366), (190, 366)], label="chat", at=(220, 358))
    s.arrow([(580, 160), (580, 196), (690, 196), (690, 366), (680, 366)])
    s.arrow([(530, 390), (470, 390)], label="session", at=(500, 382))

    s.band(12, 450, 696, 300, "Domain services (HTTP from ai-gateway)")
    tiles = [
        ("user-service", "MongoDB: users, sessions"), ("catalogue-service", "MongoDB: products"),
        ("cart-service", "Redis: carts"), ("payment-service", "Razorpay (test mode)"),
        ("shipping-service", "PostgreSQL: locations"), ("currency-service", "exchange rates"),
    ]
    for i, (name, line) in enumerate(tiles):
        x, y = (40, 370)[i % 2], 482 + (i // 2) * 88
        s.node(x, y, 310, 72, "svc", name, [line])
    s.arrow([(360, 412), (360, 478)])
    s.note(40, 746, ["Not every request visits every service: browsing uses web → gateway → catalogue."], 11)

    s.band(12, 762, 696, 138, "Paid-order events (asynchronous, at least once)")
    s.node(40, 796, 140, 60, "svc", "ai-gateway", ["outbox"])
    s.node(220, 796, 140, 60, "bus", "RabbitMQ", ["roboshop.orders"])
    s.node(400, 790, 140, 46, "svc", "shipping-worker", [])
    s.node(400, 844, 140, 46, "svc", "kafka-bridge", [])
    s.cylinder(570, 786, 120, 54, "store", "PostgreSQL", ["shipments"])
    s.cylinder(570, 842, 120, 50, "store", "Kafka", [])
    s.arrow([(180, 826), (220, 826)], "async")
    s.arrow([(360, 816), (400, 813)], "async")
    s.arrow([(360, 840), (400, 867)], "async")
    s.arrow([(540, 813), (570, 813)])
    s.arrow([(540, 867), (570, 867)], "async")

    s.band(12, 912, 696, 84, "Legend")
    s.legend(40, 940, [("sync", "HTTP"), ("async", "Event"), ("optional", "Optional"), ("aws", "AWS-managed")])
    s.legend(40, 970, [("svc", "Service"), ("ai", "AI / MCP"), ("store", "Data store"), ("bus", "Broker")])
    s.render("eks-system-context")


# 2 ─────────────────────────────────────────────────────────────────────────────────────────────
def network():
    s = Svg(720, 900, "RoboShop AI on EKS: AWS network and ingress topology",
            "One VPC across two or three Availability Zones. Public subnets hold only the Network Load Balancer and "
            "NAT gateways. Private subnets hold the EKS control-plane network interfaces, the managed system node "
            "group and Karpenter nodes, with EBS volumes in the same zone as their pods. Internet traffic enters "
            "through the NLB to the Istio ingress gateway pods by IP. Outbound traffic from nodes leaves through "
            "NAT; S3 traffic uses a gateway endpoint. Operators reach the Kubernetes API through an endpoint "
            "restricted to their own CIDR, or privately from inside the VPC.")
    s.heading("AWS network and ingress", "Private nodes; only the NLB and NAT gateways are public.")

    s.node(180, 84, 160, 50, "client", "Customers", ["internet"])
    s.node(370, 84, 160, 50, "aws", "Route 53", ["your hostname"])
    s.node(560, 84, 140, 50, "client", "Operator", ["/32 or VPN"])
    s.arrow([(340, 109), (370, 109)])
    s.text(355, 100, "DNS", 11, 600, "#1e293b", halo=True)

    s.band(12, 152, 696, 640, "VPC 10.40.0.0/16 · 2–3 AZs", stroke="#c2410c", fill="#fffaf5")
    s.band(28, 196, 664, 112, "Public subnets (/24 per AZ)")
    s.node(48, 228, 250, 62, "aws", "Network Load Balancer", ["TCP 80/443 · IP targets", "proxy protocol v2"])
    s.node(318, 228, 150, 62, "aws", "NAT gateway", ["1 (demo) or per AZ"])
    s.node(488, 228, 130, 62, "aws", "Internet", ["gateway"])
    s.arrow([(260, 134), (260, 228)])
    s.arrow([(468, 259), (488, 259)])

    s.band(28, 324, 664, 404, "Private subnets · no public IPs")
    s.node(48, 358, 300, 66, "edge", "Istio ingress gateway pods", ["registered as NLB targets"])
    s.node(372, 358, 300, 66, "control", "EKS control plane ENIs", ["API: private + allow-listed public"])
    s.arrow([(260, 290), (260, 358)], label="client traffic", at=(268, 319), anchor="start")
    s.arrow([(650, 134), (650, 358)], "control", label="kubectl", at=(642, 319), anchor="end")
    s.node(48, 444, 300, 92, "svc", "System node group", ["On-Demand · m7g.large × 2", "tainted CriticalAddonsOnly",
                                                          "Karpenter, istiod, controllers"])
    s.node(372, 444, 300, 92, "svc", "Karpenter nodes", ["arm64 · On-Demand pool", "+ tainted Spot pool",
                                                         "apps, gateway, data stores"])
    # Egress lane between the two columns, up to the NAT gateway.
    s.add('<path d="M348,490 L360,490 M372,490 L360,490" stroke="#475569" stroke-width="1.8" fill="none"/>')
    s.arrow([(360, 490), (360, 290)], label="egress", at=(366, 319), anchor="start")
    s.node(48, 556, 300, 70, "aws", "Interface endpoints", ["ECR, STS, Logs, Secrets Manager,", "SQS, EC2"], optional=True)
    s.cylinder(372, 556, 140, 70, "store", "EBS gp3", ["encrypted, zonal"])
    s.node(532, 556, 140, 70, "aws", "S3 endpoint", ["gateway, free", "(ECR layers)"])
    s.arrow([(442, 536), (442, 556)])
    s.note(48, 652, ["Egress via NAT: ECR auth, STS, AWS APIs, Razorpay, Bedrock (if configured),",
                     "Let's Encrypt and Docker Hub image pulls. Restrict further with endpoints",
                     "and Istio egress controls for production."])

    s.band(12, 808, 696, 80, "Legend")
    s.legend(40, 836, [("sync", "Traffic"), ("control", "Operator / API"), ("aws", "AWS-managed")])
    s.legend(40, 866, [("svc", "EC2 capacity"), ("store", "Storage"), ("optional", "Optional, cost driver")])
    s.render("eks-network")


# 3 ─────────────────────────────────────────────────────────────────────────────────────────────
def sequence(name, title, desc, heading, sub, actors, msgs, height, legend):
    s = Svg(720, height, title, desc)
    s.heading(heading, sub)
    n = len(actors)
    xs = [60 + i * (600 / (n - 1)) for i in range(n)]
    top = 86
    bw = min(104, (600 / (n - 1)) - 8)
    for x, (label, kind) in zip(xs, actors):
        fill, stroke, ink = KINDS[kind]
        s.add(f'<rect x="{x - bw / 2}" y="{top}" width="{bw}" height="44" rx="10" fill="{fill}" stroke="{stroke}" stroke-width="1.6"/>')
        s.text(x, top + 27, label, 11.5, 700, ink)
        s.add(f'<path d="M{x},{top + 44} L{x},{height - 70}" stroke="#cbd5e1" stroke-width="1.4" stroke-dasharray="4 4"/>')
    y = top + 80
    for i, (a, b, label, kind) in enumerate(msgs):
        x1, x2 = xs[a], xs[b]
        if a == b:
            s.arrow([(x1, y - 6), (x1 + 34, y - 6), (x1 + 34, y + 8), (x1 + 4, y + 8)], kind)
            s.text(x1 + 42, y + 4, label, 11.5, 600, "#1e293b", "start", halo=True)
        else:
            s.arrow([(x1, y), (x2 + (-4 if x2 > x1 else 4), y)], kind)
            s.text((x1 + x2) / 2, y - 7, label, 11.5, 600, "#1e293b", halo=True)
        s.step(x1 + (-16 if x2 >= x1 else 16), y, i + 1)
        y += 44
    s.legend(40, height - 40, legend)
    s.render(name)


def shopping():
    sequence(
        "eks-shopping-request", "RoboShop AI on EKS: a normal shopping request",
        "A browser request resolves through DNS to the NLB, which forwards TCP to the Istio ingress gateway. The "
        "gateway terminates TLS and routes to web. web serves static pages directly and proxies API calls to "
        "ai-gateway with mutual TLS between sidecars. ai-gateway validates the session with user-service, reads "
        "products from catalogue-service and the cart from cart-service, then returns JSON through the same path.",
        "A normal shopping request", "Product page + cart: what is actually called. No AI, no queues.",
        [("Browser", "client"), ("NLB", "aws"), ("Istio GW", "edge"), ("web", "edge"), ("ai-gateway", "svc"),
         ("user", "svc"), ("catalogue", "svc"), ("cart", "svc")],
        [(0, 1, "HTTPS (TCP)", "sync"), (1, 2, "PROXY v2 + TLS", "sync"), (2, 2, "TLS ends, route", "sync"),
         (2, 3, "mTLS", "sync"), (3, 3, "static page", "sync"), (3, 4, "/api/* mTLS", "sync"),
         (4, 5, "session check", "sync"), (4, 6, "products", "sync"), (4, 7, "cart lines", "sync"),
         (4, 3, "JSON", "sync"), (3, 0, "response (via Istio GW, NLB)", "sync")],
        700, [("sync", "Synchronous HTTP (Istio mTLS between pods)")])


# 4 ─────────────────────────────────────────────────────────────────────────────────────────────
def ai_paths():
    s = Svg(720, 860, "RoboShop AI on EKS: Moks, model and MCP paths",
            "Path A, the assistant: the browser widget calls web, which forwards to Moks widget routes; Moks calls "
            "ai-gateway /api/chat with the user's session; the gateway adds saved history references and the active "
            "provider configuration and calls the Moks engine; Moks retrieves up to four products from "
            "catalogue-service, re-checks the configuration revision with the gateway and, only if a provider is "
            "configured, calls Amazon Bedrock through Pod Identity or an allow-listed Ollama endpoint, with one "
            "optional failover and a circuit breaker. Without a provider it returns 'Please connect an LLM'. Path "
            "B, MCP: an MCP client reaches the private mcp-server by port-forward; mcp-server calls ai-gateway with "
            "the caller's own session, and the gateway re-authorizes. Moks never calls MCP.")
    s.heading("Assistant and MCP paths", "Two independent entry points. Moks never calls the MCP server.")

    s.band(12, 80, 696, 470, "A. Assistant (Moks)", "Default: no model provider configured → explicit 'connect an LLM' reply.")
    s.node(40, 132, 130, 54, "client", "Browser", ["widget"])
    s.node(210, 132, 130, 54, "edge", "web", ["/moks/*"])
    s.node(380, 132, 130, 54, "ai", "moks", ["widget routes"])
    s.node(550, 132, 140, 54, "svc", "ai-gateway", ["/api/chat"])
    s.arrow([(170, 159), (210, 159)]); s.step(190, 132, 1)
    s.arrow([(340, 159), (380, 159)]); s.step(360, 132, 2)
    s.arrow([(510, 159), (550, 159)]); s.step(530, 132, 3)
    s.node(380, 236, 310, 74, "ai", "moks engine", ["deterministic retrieval (≤ 4 products),", "16 s budget, 2 provider calls max"])
    s.arrow([(620, 186), (620, 236)], label="4 config +\nhistory", at=(628, 200), anchor="start")
    s.node(40, 236, 300, 74, "svc", "catalogue-service", ["product evidence"])
    s.arrow([(380, 262), (340, 262)]); s.step(360, 250, 5)
    s.arrow([(460, 236), (460, 210), (600, 210), (600, 186)], label="revision check", at=(500, 204))
    s.node(40, 352, 300, 74, "external", "Amazon Bedrock", ["Converse · Pod Identity role", "listed model ARNs only"], optional=True)
    s.node(380, 352, 310, 74, "external", "Ollama endpoint", ["pinned-IP allowlist"], optional=True)
    s.arrow([(460, 310), (460, 332), (190, 332), (190, 352)], label="model call", at=(320, 328)); s.step(474, 322, 6)
    s.arrow([(540, 310), (540, 352)])
    s.arrow([(380, 400), (340, 400)], label="failover (opt-in)", at=(360, 446))
    s.note(40, 470, ["Per-replica circuit breaker: 3 failures → open 30 s. Langfuse (optional) records",
                     "metadata only, never prompts or outputs. Shopping never depends on Moks:",
                     "scaling Moks to zero hides the widget and checkout keeps working."])

    s.band(12, 566, 696, 200, "B. MCP (private)", "No ingress. Every tool call is re-authorized by the gateway.")
    s.node(40, 616, 170, 64, "client", "MCP client", ["IDE / desktop / script"])
    s.node(270, 616, 170, 64, "ai", "mcp-server", ["Streamable HTTP /mcp"])
    s.node(500, 616, 190, 64, "svc", "ai-gateway", ["caller's own session"])
    s.arrow([(210, 648), (270, 648)], label="port-forward", at=(240, 640))
    s.arrow([(440, 648), (500, 648)], label="rs_auth", at=(470, 640))
    s.note(40, 708, ["Tools: search/compare products, shipping lookups, own cart; admin tools by role.",
                     "No order placement, payment, refund, delete or infrastructure tools."])

    s.band(12, 782, 696, 66, "Legend")
    s.legend(40, 816, [("sync", "HTTP"), ("ai", "AI component"), ("optional", "Configured by super admin")])
    s.render("eks-ai-paths")


# 5 ─────────────────────────────────────────────────────────────────────────────────────────────
def checkout():
    s = Svg(720, 830, "RoboShop AI on EKS: checkout, outbox and event consumers",
            "Checkout is synchronous: the browser creates an order with an idempotency key; ai-gateway reserves stock "
            "in its ledger and creates a Razorpay test-mode order through payment-service; Razorpay confirms by "
            "browser verification or a signed webhook; the gateway marks the order paid and writes an outbox event "
            "in the same transaction. Afterwards the outbox worker publishes to RabbitMQ with publisher confirms. "
            "Live merchant orders go to roboshop.shipping.orders, consumed by shipping-worker replicas scaled by KEDA, "
            "which insert into PostgreSQL with ON CONFLICT DO NOTHING and acknowledge after commit; after five "
            "failures messages dead-letter to roboshop.shipping.failed. Test orders go to an audit queue. Both go to "
            "kafka-bridge, which publishes to Kafka. The mesh never retries checkout or payment calls.")
    s.heading("Checkout, outbox and consumers", "Money moves synchronously; fulfilment follows asynchronously.")

    s.band(12, 80, 696, 286, "Synchronous checkout (no mesh retries)")
    s.node(40, 116, 150, 58, "client", "Browser", ["Idempotency-Key"])
    s.node(260, 116, 190, 58, "svc", "ai-gateway", ["reserve → pay → commit"], bold=True)
    s.node(520, 116, 170, 58, "svc", "payment-service", ["HMAC, capture check"])
    s.node(520, 214, 170, 58, "external", "Razorpay", ["test mode default"])
    s.cylinder(260, 206, 190, 92, "store", "Ledger + outbox", ["JSON (1 replica)", "or PostgreSQL"])
    s.arrow([(190, 145), (260, 145)], label="1 create", at=(225, 137))
    s.arrow([(450, 145), (520, 145)], label="2 order", at=(485, 137))
    s.arrow([(605, 174), (605, 214)])
    s.arrow([(520, 258), (470, 258), (470, 160), (450, 160)], label="3 signed\nwebhook", at=(476, 194), anchor="start")
    s.arrow([(355, 174), (355, 206)], label="4 paid + event", at=(347, 194), anchor="end")
    s.note(210, 346, ["Ambiguous payment outcomes keep their reservation;", "nothing is replayed automatically."])

    s.band(12, 382, 696, 340, "Events (at least once)")
    s.node(40, 420, 170, 60, "svc", "outbox worker", ["leased, confirms"])
    s.node(260, 420, 190, 60, "bus", "RabbitMQ", ["roboshop.orders"])
    s.arrow([(355, 298), (355, 318), (185, 318), (185, 420)], "async")
    s.arrow([(210, 450), (260, 450)], "async")
    s.node(40, 530, 200, 54, "bus", "shipping.orders", ["order.paid (live)"])
    s.node(260, 530, 190, 54, "bus", "test.orders", ["audit, no consumer"])
    s.node(470, 530, 220, 54, "bus", "kafka.orders", ["live + test"])
    s.arrow([(300, 480), (300, 502), (140, 502), (140, 530)], "async")
    s.arrow([(355, 480), (355, 530)], "async")
    s.arrow([(410, 480), (410, 502), (580, 502), (580, 530)], "async")
    s.node(40, 620, 200, 64, "svc", "shipping-worker × 1–4", ["KEDA on queue depth"], bold=True)
    s.node(470, 620, 220, 64, "svc", "kafka-bridge", ["acks after Kafka confirms"])
    s.arrow([(140, 584), (140, 620)], "async")
    s.arrow([(580, 584), (580, 620)], "async")
    s.cylinder(260, 620, 190, 64, "store", "PostgreSQL", ["event_id UNIQUE"])
    s.arrow([(240, 652), (260, 652)])
    s.note(260, 706, ["DLQ roboshop.shipping.failed after 5 attempts"], 11)

    s.band(12, 738, 696, 80, "Legend")
    s.legend(40, 768, [("sync", "Synchronous HTTP"), ("async", "Asynchronous event")])
    s.legend(40, 798, [("store", "Transactional store"), ("bus", "Queue / exchange")])
    s.render("eks-checkout-events")


# 6 ─────────────────────────────────────────────────────────────────────────────────────────────
def trust():
    s = Svg(720, 860, "RoboShop AI on EKS: Istio trust and authorization boundaries",
            "Three separate controls. Gatekeeper admission policies decide which pods may be created in roboshop-ai: "
            "approved, digest-pinned images, resources, non-root, no token mount, labels, and public exposure only "
            "through the Istio gateway. Inside the mesh, every application pod has a sidecar with its own "
            "ServiceAccount identity; mutual TLS is strict, a namespace-wide allow-nothing policy denies everything, "
            "and one ALLOW policy per service admits only the verified callers. Data stores run without sidecars "
            "behind Kubernetes NetworkPolicies enforced by the VPC CNI. Applications enforce user-level "
            "authorization themselves.")
    s.heading("Trust and authorization boundaries", "Admission, workload identity and user authorization are separate layers.")

    s.band(12, 80, 696, 96, "1. Admission (Gatekeeper, roboshop-ai only)", stroke="#a21caf", fill="#fdf4ff")
    s.note(28, 128, ["approved registry + digest · requests/limits · non-root, no privilege escalation,",
                     "drop ALL · no token mount · owner/env labels · LoadBalancer only in istio-ingress"], 12, "#4a044e")

    s.band(12, 190, 696, 448, "2. Mesh (Istio sidecars, mTLS STRICT, allow-nothing + per-edge ALLOW)", stroke="#047857", fill="#f6fdf9")
    s.node(40, 228, 170, 52, "edge", "ingress gateway", ["sa/istio-ingressgateway"])
    s.node(276, 228, 170, 52, "edge", "web", ["sa/web"])
    s.node(510, 228, 170, 52, "ai", "moks", ["sa/moks"])
    s.node(40, 330, 170, 56, "ai", "mcp-server", ["no in-mesh callers"])
    s.node(276, 330, 170, 56, "svc", "ai-gateway", ["sa/ai-gateway"], bold=True)
    s.arrow([(210, 254), (276, 254)])
    s.arrow([(446, 254), (510, 254)])
    s.arrow([(361, 280), (361, 330)])
    s.arrow([(595, 280), (595, 358), (446, 358)], both=True, label="both ways", at=(520, 350))
    s.arrow([(210, 358), (276, 358)])
    names = ["user", "catalogue", "cart", "payment", "shipping", "currency"]
    for i, n in enumerate(names):
        x = 40 + i * 110
        s.node(x, 450, 100, 48, "svc", n, [])
        s.arrow([(361, 386), (361, 420), (x + 50, 420), (x + 50, 450)])
    s.add('<rect x="40" y="522" width="640" height="100" rx="10" fill="#fef2f2" stroke="#dc2626" stroke-width="1.4" stroke-dasharray="6 4"/>')
    s.text(360, 548, "Everything else is denied", 14, 700, "#7f1d1d")
    s.note(56, 572, ["Also allowed (not drawn): web → currency · moks → catalogue, user · user → shipping.",
                     "Denied, for example: cart → payment, any pod → mcp-server.",
                     "Rolled out in dry-run (denials only logged), then enforced."], 11.5, "#7f1d1d")

    s.band(12, 652, 696, 110, "3. Outside the mesh (NetworkPolicy via VPC CNI)", stroke="#b45309", fill="#fffcf5")
    stores = [("MongoDB", "gateway, user, catalogue"), ("Redis", "cart, shipping"), ("PostgreSQL", "shipping + worker"),
              ("RabbitMQ", "gateway, workers; KEDA :15672")]
    for i, (n, l) in enumerate(stores):
        s.cylinder(28 + i * 172, 684, 160, 66, "store", n, [l])

    s.band(12, 776, 696, 72, "Legend")
    s.legend(40, 812, [("sync", "Allowed call (mTLS)"), ("svc", "Meshed workload"), ("store", "Not meshed")])
    s.render("eks-trust-boundaries")


# 7 ─────────────────────────────────────────────────────────────────────────────────────────────
def scaling():
    s = Svg(720, 760, "RoboShop AI on EKS: KEDA and Karpenter scaling chain",
            "Paid orders accumulate in roboshop.shipping.orders. KEDA polls the RabbitMQ management API every 15 "
            "seconds with a monitoring-only user and raises the HPA target for shipping-worker at 20 messages per "
            "replica, between 1 and 4 replicas, falling back to 2 replicas if the API is unreachable. New pods that "
            "do not fit stay Pending; Karpenter, running on the stable system node group, launches an arm64 node "
            "from the Spot or On-Demand NodePool within its CPU and memory limits, using the SQS interruption queue "
            "for Spot notices. When the queue drains, KEDA scales down after a five-minute cooldown and Karpenter "
            "consolidates empty or underutilized nodes within its disruption budget.")
    s.heading("Queue backlog → pods → nodes", "KEDA scales pods from queue depth; Karpenter adds nodes only for Pending pods.")

    rows = [
        ("bus", "RabbitMQ", "roboshop.shipping.orders: ready + unacked"),
        ("control", "KEDA (system nodes)", "every 15 s · 20 msgs/replica · min 1, max 4"),
        ("control", "HPA keda-hpa-shipping-worker", "+1 pod/min up · −1 pod/2 min after 5 min"),
        ("svc", "shipping-worker pods", "new pods Pending if no room"),
        ("control", "Karpenter (system nodes)", "NodePool spot (tainted) or general"),
        ("aws", "EC2 arm64 node", "≤ 16 vCPU Spot / 32 vCPU On-Demand"),
    ]
    y = 90
    for i, (kind, title, line) in enumerate(rows):
        s.node(140, y, 440, 62, kind, title, [line])
        s.step(116, y + 31, i + 1)
        if i:
            s.arrow([(360, y - 30), (360, y)], "control" if kind in ("control", "aws") else "sync")
        y += 92
    s.arrow([(580, 121 + 92 * 5), (640, 121 + 92 * 5), (640, 121 + 92 * 3), (580, 121 + 92 * 3)], "control",
            label="schedules", at=(646, 121 + 92 * 4), anchor="start")
    s.note(40, 650, ["Fallback: management API unreachable 4 polls → hold 2 replicas.",
                     "Scale down: queue empty → KEDA cooldown 300 s → Karpenter consolidates within each NodePool budget.",
                     "Bounded by shipping-db connections (≤ 10 per worker); raise max only with DB capacity."])
    s.legend(40, 730, [("sync", "Pods"), ("control", "Control-plane action"), ("aws", "EC2")])
    s.render("eks-scaling-chain")


# 8 ─────────────────────────────────────────────────────────────────────────────────────────────
def telemetry():
    s = Svg(720, 760, "RoboShop AI on EKS: telemetry pipeline",
            "Application pods and Istio sidecars send OTLP traces to the node-local OpenTelemetry agent, which adds "
            "Kubernetes metadata, drops health-check spans, samples, redacts query strings, authorization headers, "
            "cookies and email addresses, and exports to Jaeger. The same agent tails container logs, redacts them "
            "and writes them to a CloudWatch Logs group with finite retention. Prometheus scrapes application and "
            "Envoy metrics merged by the sidecar on port 15020, plus KEDA, Karpenter and istiod, and evaluates "
            "alerts; Grafana queries Prometheus. EKS control-plane logs go to CloudWatch directly. Moks can send "
            "metadata-only observations to Langfuse when credentials exist. Telemetry failures never fail requests.")
    s.heading("Telemetry pipeline", "One node agent for logs and traces; Prometheus for metrics.")

    s.band(12, 80, 696, 116, "Sources")
    s.node(40, 112, 200, 64, "svc", "App pods", ["OTLP traces, JSON stdout,", "/metrics"])
    s.node(260, 112, 200, 64, "edge", "Istio sidecars + gateway", ["spans, merged :15020"])
    s.node(480, 112, 210, 64, "control", "KEDA · Karpenter · istiod", ["controller metrics"])

    s.band(12, 212, 696, 150, "Collection")
    s.node(40, 248, 420, 92, "obs", "OpenTelemetry agent (DaemonSet)", ["k8s metadata · drop health spans · sample",
                                                                         "redact query, auth, cookies, emails"], bold=True)
    s.node(480, 248, 210, 92, "obs", "Prometheus", ["PodMonitor + ServiceMonitors", "alert rules, 7 d"])
    s.arrow([(140, 176), (140, 248)], "telemetry", label="traces\n+ logs", at=(150, 206), anchor="start")
    s.arrow([(330, 176), (330, 248)], "telemetry", label="spans", at=(338, 214), anchor="start")
    s.arrow([(420, 176), (420, 200), (540, 200), (540, 248)], "telemetry", label="scrape :15020", at=(476, 196))
    s.arrow([(640, 176), (640, 248)], "telemetry")

    s.band(12, 378, 696, 178, "Backends")
    s.node(40, 414, 200, 64, "obs", "Jaeger", ["in-memory (demo)"])
    s.node(260, 414, 200, 64, "aws", "CloudWatch Logs", ["containers · 30 d"])
    s.node(480, 414, 210, 64, "obs", "Grafana", ["dashboards"])
    s.node(260, 494, 200, 50, "aws", "CloudWatch Logs", ["EKS control plane"])
    s.node(480, 494, 210, 50, "external", "Langfuse", ["metadata only"], optional=True)
    s.arrow([(140, 340), (140, 414)], "telemetry")
    s.arrow([(360, 340), (360, 414)], "telemetry")
    s.arrow([(585, 340), (585, 414)], "sync", label="query", at=(593, 382), anchor="start")

    s.note(40, 584, ["Correlation: trace IDs appear in JSON logs (traceId) and Envoy access logs;",
                     "search CloudWatch by traceId, then open the trace in Jaeger.",
                     "Failure isolation: exporters queue and retry in the background; a down backend",
                     "drops telemetry, never a customer request."])
    s.band(12, 670, 696, 76, "Legend")
    s.legend(40, 706, [("telemetry", "Telemetry"), ("sync", "Query"), ("aws", "AWS-managed"), ("optional", "Optional")])
    s.render("eks-telemetry")


if __name__ == "__main__":
    for build in (system_context, network, shopping, ai_paths, checkout, trust, scaling, telemetry):
        build()
    print("\n".join(sorted(p.name for p in OUT.glob("*.svg"))))
