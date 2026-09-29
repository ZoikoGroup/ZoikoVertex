import type { Metadata } from "next";
import {
  Plus_Jakarta_Sans,
  JetBrains_Mono,
  Bricolage_Grotesque,
} from "next/font/google";
import { Providers } from "./providers";
import Navbar from "@/components/navbar/Navbar";
import Footer from "@/components/footer/Footer";
import CustosWidget from "@/components/custos/CustosWidget";
import Script from "next/script";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ZoikoVertex | Governed Agentic Marketing OS",
  description:
    "Run marketing with financial control. AI agent workflows, approval controls, ROI evidence, and audit-ready governance for enterprise teams.",
  keywords: [
    "AI Governance",
    "Agentic Marketing",
    "Enterprise AI",
    "Social Media Automation",
    "Brand Integrity",
    "Marketing OS",
  ],
  authors: [{ name: "Zoiko Group" }],
  metadataBase: new URL("https://zoikovertex.com"),
  openGraph: {
    title: "ZoikoVertex | Governed Agentic Marketing OS",
    description:
      "Run marketing with financial control. AI agent workflows, approval controls, ROI evidence, and audit-ready governance.",
    url: "https://zoikovertex.com",
    siteName: "ZoikoVertex",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ZoikoVertex | Governed Agentic Marketing OS",
    description:
      "Run marketing with financial control. AI agent workflows, approval controls, ROI evidence, and audit-ready governance.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${jakarta.variable} ${jetbrains.variable} ${bricolage.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta
          name="format-detection"
          content="telephone=no, email=no, address=no"
        />
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '1006709255052325');
            fbq('track', 'PageView');
          `}
        </Script>

        {/* Google analytics */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-3EEJFHC8MZ"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-3EEJFHC8MZ');
          `}
        </Script>

        {/* Google search console */}
        <meta
          name="google-site-verification"
          content="L0aHGNugrX58O8zM2hKwKhmjDFmdkww64-xUkOe5oYk"
        />

        {/* FAQ schema */}
        <Script
          id="faq-schema"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: `{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [{
    "@type": "Question",
    "name": "What is ZoikoVertex?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex is a governed AI marketing operations platform for enterprise teams, agencies, multi-brand organizations, and governance-led marketing departments. It brings AI-assisted workflows, campaign approvals, brand controls, audit trails, evidence records, integrations, and performance intelligence into one controlled operating environment."
    }
  },{
    "@type": "Question",
    "name": "What does ZoikoVertex do?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex helps organizations plan, create, review, approve, publish, measure, and evidence marketing work. It coordinates AI agents, human reviewers, policies, permissions, connected systems, and performance data so teams can increase execution speed without removing accountability."
    }
  },{
    "@type": "Question",
    "name": "Is ZoikoVertex a platform or an operating system?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex should be described publicly as a governed AI marketing operations platform. “Governed agentic marketing operating system” is a useful secondary description because the platform coordinates people, AI agents, workflows, approvals, integrations, evidence, and outcomes across the marketing lifecycle."
    }
  },{
    "@type": "Question",
    "name": "What is governed AI marketing?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Governed AI marketing is the use of artificial intelligence within defined roles, permissions, policies, brand standards, approval paths, and human oversight requirements. It allows organizations to use AI for speed and scale while preserving control over what can be created, approved, published, changed, or escalated."
    }
  },{
    "@type": "Question",
    "name": "How is ZoikoVertex different from conventional social media management software?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Conventional social media platforms primarily help teams schedule, publish, monitor, engage, and report. ZoikoVertex is centered on governed execution: policy checks, role-bound authority, AI-agent controls, multi-stage approvals, immutable audit events, evidence records, and financial or performance context. Publishing is one output within the wider operating model."
    }
  },{
    "@type": "Question",
    "name": "Is ZoikoVertex only a content-generation tool?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "No. Content generation is one capability within ZoikoVertex. The platform also governs strategy, brand standards, risk classification, approvals, publishing authorization, engagement escalation, attribution, evidence capture, auditability, and executive visibility."
    }
  },{
    "@type": "Question",
    "name": "Does ZoikoVertex replace existing marketing tools?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Not necessarily. ZoikoVertex is designed to operate as a governed execution layer across existing social, CRM, collaboration, project, content, analytics, data, identity, and storage systems. Organizations can preserve useful tools while applying consistent authority, approval, and evidence controls across the work that moves between them."
    }
  },{
    "@type": "Question",
    "name": "Who operates ZoikoVertex?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex is operated by Zoiko Tech Inc. and forms part of the wider Zoiko Group technology ecosystem. Contracting entity, service terms, privacy documentation, and regional arrangements should be confirmed in the applicable customer agreement and legal documentation."
    }
  },{
    "@type": "Question",
    "name": "Who should use ZoikoVertex?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex is designed for organizations that need stronger control over AI-assisted marketing activity, including enterprise marketing teams, marketing operations leaders, agencies, multi-brand groups, regulated businesses, brand teams, legal and compliance reviewers, security teams, procurement stakeholders, and executive leadership."
    }
  },{
    "@type": "Question",
    "name": "Is ZoikoVertex only for large enterprises?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "No. ZoikoVertex supports teams at different levels of maturity and complexity. Smaller teams can begin with limited, governed use cases, while larger organizations can deploy multi-brand workspaces, advanced approval chains, enterprise identity controls, evidence capabilities, and customized governance architecture."
    }
  },{
    "@type": "Question",
    "name": "Can agencies use ZoikoVertex for client work?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Yes. Agencies can separate client workspaces, apply client-specific Brand Libraries and approval rules, route work through internal and client reviewers, limit external collaborator access, and preserve evidence showing what the client reviewed, approved, changed, or rejected."
    }
  },{
    "@type": "Question",
    "name": "Can multi-brand and global organizations use ZoikoVertex?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Yes. ZoikoVertex can separate brands, departments, regions, clients, or campaigns into controlled workspaces while maintaining centralized governance and executive oversight. Permissions, policies, approval authority, data access, and reporting can be scoped to the appropriate organizational context."
    }
  },{
    "@type": "Question",
    "name": "Which industries are a strong fit for ZoikoVertex?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex is especially relevant where marketing claims, approvals, brand consistency, auditability, or reputational exposure matter. Priority use cases include enterprise retail, financial services and FinTech, healthcare, B2B SaaS, logistics, telecommunications, agencies, and multi-brand organizations."
    }
  },{
    "@type": "Question",
    "name": "Is ZoikoVertex suitable for regulated marketing?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Yes, subject to correct implementation and legal review. ZoikoVertex can route regulated claims, disclosures, sensitive content, and AI-assisted outputs through defined reviewers and approval authorities while preserving the applicable policy version, decision rationale, content state, and evidence record. The platform does not replace professional legal or regulatory advice."
    }
  },{
    "@type": "Question",
    "name": "What AI agents are included in ZoikoVertex?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex currently presents five governed AI agents: the Strategy Agent, Content Agent, Publishing Agent, Engagement Agent, and Revenue Attribution Agent. Each agent owns a defined part of the marketing lifecycle and operates within role permissions, policies, brand standards, approval chains, and audit logging."
    }
  },{
    "@type": "Question",
    "name": "Can ZoikoVertex AI agents publish content automatically?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "AI agents can execute only within the authority and approval rules configured for the relevant workflow. High-impact publishing, sensitive external communication, policy exceptions, and budget-related actions can require authorized human approval. The Publishing Agent verifies the approved content state, policy version, release conditions, and authorization before execution."
    }
  },{
    "@type": "Question",
    "name": "Does ZoikoVertex replace human marketers?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "No. ZoikoVertex is designed to strengthen human judgment and operating discipline. AI can research, recommend, draft, classify, route, analyze, and assist execution, while authorized people retain responsibility for material decisions, brand judgment, approvals, exceptions, and final accountability."
    }
  },{
    "@type": "Question",
    "name": "How does AI workflow orchestration work?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex coordinates AI agents, human roles, policy checks, integrations, approvals, and evidence through a controlled execution path. At the workflow level, the platform uses six governed stages: trigger, route, execute, verify, approve, and record. Each stage creates the context and evidence needed for the next authorized action."
    }
  },{
    "@type": "Question",
    "name": "How is AI workflow orchestration different from basic automation?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Basic automation usually performs a predefined task when a condition is met. ZoikoVertex adds identity, role scope, policy evaluation, risk classification, autonomy limits, approval routing, escalation, evidence capture, and outcome measurement around material actions. The objective is not merely to automate work, but to make execution accountable."
    }
  },{
    "@type": "Question",
    "name": "Can humans review AI actions before execution?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Yes. Human-in-the-loop controls can require an authorized reviewer, validator, approver, compliance officer, or executive signatory to inspect and decide on an AI-assisted action before it proceeds. Review depth can vary by risk, content type, channel, jurisdiction, brand, campaign, or action."
    }
  },{
    "@type": "Question",
    "name": "Can AI autonomy be limited by role or risk?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Yes. AI capabilities can be restricted by user role, agent, workspace, brand, region, channel, content type, risk class, action, policy, and approval requirement. An agent should receive only the authority necessary for its approved purpose, and access denial or escalation should be explicit and logged."
    }
  },{
    "@type": "Question",
    "name": "What happens when an AI action is high risk?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "High-risk or critical actions can be blocked, escalated, or routed to additional authorities according to the applicable policy. The workflow can require named approvers, legal or compliance review, executive sign-off, sealed evidence, or crisis controls before any action is released."
    }
  },{
    "@type": "Question",
    "name": "How do approval workflows work in ZoikoVertex?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex classifies work by policy, content type, channel, jurisdiction, sensitivity, and autonomy level, then routes it to the required reviewer or approval authority. Decisions can be approved, rejected, returned for changes, or escalated. Approved work proceeds only after the required decision and evidence stages are complete."
    }
  },{
    "@type": "Question",
    "name": "What is the Three-Key Approval Protocol?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "The Three-Key Approval Protocol is ZoikoVertex’s highest-assurance authorization model. It requires three independent confirmations: a system integrity and authority check, governance and brand validation, and an authorized human release signature. No single actor controls the full chain, and each confirmation is bound to the approved content state."
    }
  },{
    "@type": "Question",
    "name": "Can approval stages be customized?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Yes. Approval paths can be configured by workspace, brand, client, campaign, market, content type, channel, jurisdiction, risk class, and business authority. The available depth and configuration depend on the selected plan and implementation scope"
    }
  },{
    "@type": "Question",
    "name": "Can users bypass approvals?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Standard users cannot bypass policy-bound approval gates. Where an authorized exception or break-glass mechanism exists, it must use elevated authority, defined limits, time-boxed access where applicable, and a recorded exception. An override does not erase the original control requirement or audit history."
    }
  },{
    "@type": "Question",
    "name": "What happens if approved content is changed?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "A material change alters the approved content state and invalidates the prior release authorization. ZoikoVertex can detect the change, update the content hash, return the item to the Review Queue, and require a new approval chain before publication."
    }
  },{
    "@type": "Question",
    "name": "Does ZoikoVertex enforce separation of duties?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Yes. Creation, review, validation, approval, publishing, governance administration, security administration, and audit access can be separated. A user may hold more than one role, but each action remains independently permissioned and scoped so visibility does not automatically create authority."
    }
  },{
    "@type": "Question",
    "name": "What is the Brand Library?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "The Brand Library centralizes approved brand voice, terminology, claims, prohibited phrases, visual guidance, regional requirements, and supporting sources. These standards can be applied during creation and review so brand and claims controls operate before publication, not only after an issue occurs."
    }
  },{
    "@type": "Question",
    "name": "What are the Policy Center, Validation Desk, and Crisis Console?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "The Policy Center manages versioned governance rules. The Validation Desk gives authorized reviewers a controlled surface for checking claims, sources, brand fit, policy results, and risk. The Crisis Console supports urgent, exceptional, or sensitive situations through higher-assurance access, authorization, logging, and review controls."
    }
  },{
    "@type": "Question",
    "name": "What is the Evidence Vault?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "The Evidence Vault is ZoikoVertex’s controlled repository for approval records, policy snapshots, decision histories, content states, prompts and outputs where applicable, publishing evidence, chain-of-custody information, and related governance artifacts. Availability, retention, legal hold, and export functions depend on the contracted plan."
    }
  },{
    "@type": "Question",
    "name": "What does audit-ready marketing mean?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Audit-ready marketing means that material actions, decisions, approvals, policy checks, exceptions, publishing events, and evidence are recorded as the work occurs. Teams can explain what happened, who acted, what authority applied, which content version was approved, and why the action was allowed or blocked."
    }
  },{
    "@type": "Question",
    "name": "Can ZoikoVertex audit records be edited, deleted, or backdated?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex is designed around append-only, immutable audit events for material actions. Standard users should not be able to silently edit, delete, or backdate those records. Corrections, overrides, exports, and exceptions should create new events that preserve the original history rather than rewriting it."
    }
  },{
    "@type": "Question",
    "name": "Can auditors review evidence without operational authority?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Yes. Auditor and executive-viewer roles can be configured for read-oriented access to governance, audit, evidence, and performance information without granting content creation, approval, publishing, policy-administration, or override rights. Access itself can also be logged and, where appropriate, watermarked."
    }
  },{
    "@type": "Question",
    "name": "Is ZoikoVertex secure?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex is designed for enterprise security and procurement review, with role-based and attribute-based access controls, least-privilege permissions, workspace separation, audit logging, approval controls, AI-action traceability, identity integration options, and documented security review processes. Each buyer should assess the current implementation and assurance materials against its own requirements."
    }
  },{
    "@type": "Question",
    "name": "Does ZoikoVertex support SSO, SAML, SCIM, MFA, RBAC, and ABAC?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Qualifying enterprise configurations support SSO or SAML authentication, SCIM provisioning, MFA-aware controls, role-based access control, and attribute-based scope enforcement. Availability varies by plan and contract. Visibility, editing, approval, publishing, export, and governance administration should remain separately permissioned."
    }
  },{
    "@type": "Question",
    "name": "Is ZoikoVertex SOC 2 or ISO 27001 certified?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Certification status, scope, audit period, and supporting reports must be confirmed through current ZoikoVertex Trust Center or enterprise security-review documentation. The website should not describe ZoikoVertex as certified unless the applicable certificate or independent report is current, valid, and covers the relevant service scope."
    }
  },{
    "@type": "Question",
    "name": "How does ZoikoVertex handle privacy and customer data?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex privacy obligations should be governed by the published Privacy Policy, customer agreement, Data Processing Addendum, subprocessor information, and configured service architecture. Claims about customer-content training, prompt storage, retention, AI providers, international transfers, or regional data residency must be specific, technically verified, and contractually accurate before publication."
    }
  },{
    "@type": "Question",
    "name": "What systems can ZoikoVertex integrate with?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex is designed to connect with social and publishing platforms, CRM systems, collaboration tools, project-management applications, content and digital-asset systems, analytics platforms, data warehouses, identity providers, storage services, APIs, webhooks, and event streams. Supported connectors and action scopes should be confirmed on the current Integrations page."
    }
  },{
    "@type": "Question",
    "name": "Does ZoikoVertex provide APIs and webhooks?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Developer and enterprise deployments can support APIs, webhooks, and event-driven integration patterns for approved data, workflow, identity, status, and execution use cases. Authentication, rate limits, event coverage, write permissions, support, and service levels depend on the selected plan and implementation agreement."
    }
  },{
    "@type": "Question",
    "name": "Can ZoikoVertex connect marketing activity to revenue?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Yes, where the required data is available and authorized. The Revenue Attribution Agent and ROI capabilities can connect campaign activity to pipeline, revenue, efficiency, and commercial outcomes while recording model assumptions and evidence. Attribution quality depends on the completeness, accuracy, identity resolution, and permissions of the connected data."
    }
  },{
    "@type": "Question",
    "name": "Can executives see risk, approvals, and performance in one place?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Yes. The Executive Command Center can bring together workflow status, pending decisions, blocked actions, exceptions, approval performance, governance posture, campaign outcomes, ROI context, and cross-brand visibility according to authorized access."
    }
  },{
    "@type": "Question",
    "name": "Can ZoikoVertex identify workflow bottlenecks and wasted spend?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex can surface pending approvals, SLA breaches, risk states, repeated rework, blocked execution, underperforming activity, and available ROI signals. These insights can support faster decisions and better capital allocation, but actual savings or performance improvement depend on the organization’s data, adoption, configuration, and management decisions."
    }
  },{
    "@type": "Question",
    "name": "How much does ZoikoVertex cost?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "ZoikoVertex offers four plan levels: Vertex Starter, Vertex Growth, Vertex Scale, and Vertex Corporate. Starter is positioned as the free entry tier; Growth and Scale are paid plans; Corporate is priced according to enterprise requirements. Current prices, user limits, profiles, brands, retention, and entitlements should always be taken from the live Pricing page."
    }
  },{
    "@type": "Question",
    "name": "Does ZoikoVertex offer a free plan or trial?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Yes. Vertex Starter is the free entry plan, and the current Pricing page offers a 14-day Vertex Growth trial. Trial conversion, downgrade behavior, data preservation, and current eligibility should be confirmed in the published pricing and subscription terms."
    }
  },{
    "@type": "Question",
    "name": "Which ZoikoVertex plan is right for my organization?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Starter is intended for initial evaluation; Growth supports a governed single-brand operating team; Scale adds multi-brand coordination, advanced approvals, stronger evidence packaging, and broader intelligence; Corporate supports customized enterprise governance, identity, evidence, legal-hold, implementation, and service requirements. Final fit should be based on users, brands, risk, integrations, retention, security, and approval complexity."
    }
  },{
    "@type": "Question",
    "name": "How long does ZoikoVertex implementation take?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Implementation time depends on the number of brands, users, roles, workflows, approval paths, integrations, identity requirements, migration needs, data controls, security review, and training scope. ZoikoVertex recommends phased onboarding rather than a big-bang deployment, beginning with a controlled use case and expanding after governance and workflow validation."
    }
  },{
    "@type": "Question",
    "name": "How can my organization evaluate or buy ZoikoVertex?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Organizations can start with the free or trial experience where appropriate, request a tailored demonstration, review a governed workflow from trigger to evidence, assess plan fit, and complete the required technical, security, privacy, legal, procurement, and commercial review. Enterprise demonstrations should be configured around the buyer’s actual brand structure, approval model, stack, and risk profile."
    }
  }]
}`,
          }}
        />
      </head>
      <body className="flex flex-col min-h-screen" suppressHydrationWarning>
        <noscript>
          {/* Facebook Pixel noscript tracking pixel — must stay a raw <img> (3rd-party pixel, not an optimized asset) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            src="https://www.facebook.com/tr?id=1006709255052325&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
        <Providers>
          <Navbar />
          {children}
          <Footer />
          <CustosWidget />
        </Providers>
      </body>
    </html>
  );
}
