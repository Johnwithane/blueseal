# Blue Seal — Privacy Policy

**Effective date:** 2026-05-21
**Last updated:** 2026-06-15

This Privacy Policy explains how **Blue Seal**, a sole proprietorship operated by **James Jansen** in British Columbia, Canada ("Blue Seal", "we", "us", "our"), collects, uses, discloses, retains and protects personal information when you use the Blue Seal progressive web application, websites under https://blueseal.app, and related services (together, the "**Service**").

> **[Before publishing: replace `[OPERATOR LEGAL NAME]` here and in § 13 with the registered name the Blue Seal sole proprietorship operates under, and have this reviewed by a lawyer.]**

We are committed to handling personal information in accordance with Canada's *Personal Information Protection and Electronic Documents Act* (PIPEDA) and, for residents of British Columbia, the BC *Personal Information Protection Act* (PIPA BC).

If you do not agree with this Privacy Policy, do not use the Service.

---

## 1. Who this policy covers

Blue Seal serves three types of users:

- **Clients** — people who hire tradespeople through the Service.
- **Tradespeople (or "Tradies")** — verified service providers offering trade work through the Service.
- **Visitors** — anyone who accesses the Service without an account.

Different sections of this policy apply to each, and we note where this matters.

---

## 2. The personal information we collect

We collect only the information we need to operate the Service, verify users, facilitate jobs between clients and tradespeople, and meet our legal obligations.

### 2.1 Information you provide directly

**All account holders**
- Name (or display name)
- Email address
- Password (stored as a salted hash by Firebase Authentication — we never see your plain-text password)
- Profile photo (optional)
- Phone number (optional for clients; required for tradespeople)
- Communications you send us (support emails, in-app chat messages, dispute submissions)

**Clients — additional**
- Service address(es) for jobs you post (street address, city, postal code, geolocation)
- Photos and descriptions you upload when submitting a request (these may incidentally include images of your property, possessions, or other people)
- Reviews you publish of tradespeople
- When you pay an invoice **by card** through the Service, your payment is processed by **Stripe** (our payment processor). Blue Seal receives the payment status and the last four digits / card brand from Stripe — **never your full card number** (see § 4)

**Tradespeople — additional**
- Trade(s), years of experience, bio, pricing, service area and availability
- **Trade certification documents** (PDFs or images), including issuing body, certificate number, and expiry date
- **Government-issued photo identification** (driver's licence, passport, or provincial ID) used solely to verify your identity for platform safety
- Portfolio photos
- Payment instructions / banking information you publish on invoices
- Stripe customer and connected-account identifiers when you subscribe to Blue Seal Pro or set up payouts (see § 4)
- Private reviews of clients you have worked with

### 2.2 Information we collect automatically

When you use the Service we automatically collect:

- **Device and connection data:** IP address, browser type and version, operating system, device identifiers, language and timezone settings
- **Usage data:** pages and features viewed, actions taken, timestamps, error reports
- **Approximate location:** derived from your IP address — including via a third-party IP-geolocation lookup service that receives your IP address to return an approximate city/region so search can default to your area — and (with your permission) precise location from your browser when searching for tradespeople near you
- **Cookies and similar technologies:** see § 9 below

### 2.3 Information from third parties

- **Google Sign-In:** if you sign up using Google, we receive your name, email and profile photo from Google.
- **Stripe:** when a tradesperson subscribes to Blue Seal Pro, or when a client pays an invoice by card, Stripe shares status (subscription or payment), the last four digits / brand of the payment method, and billing country with us. We never receive full card numbers. When a tradesperson onboards for payouts, Stripe collects their identity and banking details directly and confirms their payout-eligibility status to us.

We do **not** purchase personal information from data brokers.

---

## 3. Why we collect personal information and the legal basis

We collect and use personal information for the purposes set out in this section. We rely on your consent (given when you accept this policy at signup, and through specific in-app permissions such as location), as well as on the reasonable-purposes grounds permitted under PIPEDA and PIPA BC.

| Purpose | Information used | Why we need it |
|---|---|---|
| Create and manage your account | Name, email, password, role | To let you sign in and use role-appropriate features |
| Show tradespeople near you | Approximate or precise location | To rank and map tradespeople by distance |
| Display tradesperson profiles publicly | Tradesperson name, photo, bio, trades, service area, ratings, reviews | To let clients evaluate and choose a tradesperson |
| Verify tradesperson identity and qualifications | Government photo ID, certification documents | To meet our verification commitments to clients and reduce fraud |
| Facilitate jobs between users | Job descriptions, photos, addresses, chat messages, schedules | To make it possible to coordinate the work |
| Generate and send invoices; process card payments | Job and payment data, tradesperson payment instructions, Stripe identifiers | To support tradespeople's billing and process in-app card payments + payouts via Stripe |
| Provide the AI assistant (Pro tradespeople) and receipt-scanning (all tradespeople) | Job chat history, intake form data, intake/job photos, receipt images | To produce diagnoses, quote/invoice drafts, summaries and parsed expenses on request |
| Manage Blue Seal Pro subscriptions | Stripe customer id, subscription status, plan | To provide, bill, renew and cancel the subscription |
| Operate mutual review system | Job participation, ratings and review text | To maintain trust on both sides of the marketplace |
| Send essential service communications | Email, account events | To notify you of account activity, requests, bookings, invoices, vetting decisions |
| Send marketing communications (with consent) | Email | To send product updates and offers — you may unsubscribe at any time |
| Protect the Service and our users | Device, usage and content data | To detect and prevent fraud, abuse, harassment and security incidents |
| Comply with legal obligations | Any of the above | To respond to lawful requests and meet tax / record-keeping rules |
| Improve the Service | Usage and error data, mostly aggregated | To understand which features help and where the product breaks |

We do not use your personal information for purposes materially different from these without your consent.

### 3.1 Automated decision-making

We do not use solely automated decision-making to make decisions that produce legal or similarly significant effects about you. Vetting decisions, suspensions and dispute outcomes are made by a human Blue Seal team member.

---

## 4. How and when we disclose personal information

We disclose personal information only in the circumstances described below.

### 4.1 Disclosure between users

The whole point of the Service is to connect clients and tradespeople, so some information is necessarily shared between users:

- **Public tradesperson profiles** are visible to all Service users and (where indexed) to the public. They include the tradesperson's display name, photo, trades, service area on a map, portfolio photos, ratings and reviews. Government ID images are **never** included in a public profile.
- **Within a job:** the matched client and tradesperson can see each other's display name, photo, the client's service address for that job, intake form details, and the full chat thread for that job.
- **Reviews:**
  - **Public reviews** by clients about tradespeople are visible to all users and are attributed to the client's display name.
  - **Private reviews** by tradespeople about clients are visible only to other verified tradespeople and to Blue Seal administrators. They are not shown to the client they describe.

If you don't want information shared between users, don't submit a request or accept a job.

### 4.2 Disclosure to service providers

We use third-party service providers ("processors") who handle personal information on our behalf under written contracts that restrict use to our instructions and require safeguards comparable to ours.

| Provider | Purpose | Where they process data |
|---|---|---|
| **Google LLC (Firebase / Google Cloud)** — Authentication, Firestore database, Cloud Storage, Cloud Functions, Hosting, App Check, Vertex AI (Gemini) | Core backend, identity, file storage, AI assistant | United States and other Google regions |
| **Google LLC (Maps Platform)** | Map display and place search | United States |
| **Stripe, Inc.** | Blue Seal Pro subscription billing; in-app card payments; tradesperson payouts via Stripe Connect. Connect onboarding collects a tradesperson's identity, business and banking information **directly from the tradesperson** under Stripe's own terms — Blue Seal does not receive or store it. For card payments, Stripe shares payment status and the last four digits / brand of the card; Blue Seal never receives full card numbers. | United States, Canada |
| **Resend** | Transactional and (where you've consented) marketing email | United States |
| **Sentry** | Error and performance monitoring | United States |
| **Cloudflare** *(if used for DNS / CDN)* | Edge delivery, DDoS protection | Global edge |

These providers may process personal information **outside Canada**. Foreign authorities may, under their laws, compel disclosure of personal information processed within their jurisdictions. We choose providers that publish data-processing terms and security commitments aligned with our obligations.

### 4.3 Disclosure to Blue Seal administrators

Members of the Blue Seal team with administrator role may access user information to:

- vet tradesperson applications (review cert and ID images);
- moderate the platform (review chats and content if flagged);
- handle support and disputes;
- detect fraud or policy violations;
- comply with legal obligations.

Every administrator action that touches another user's account is written to an internal audit log.

### 4.4 Legal disclosures

We may disclose personal information without your consent where permitted or required by law, including:

- to comply with a subpoena, court order, warrant, or other lawful demand;
- to protect the rights, property or safety of Blue Seal, our users or the public;
- to investigate or prevent fraud, abuse, harassment or breach of our Terms;
- as part of an actual or contemplated **business transaction** (merger, acquisition, financing, or sale of all or part of our assets) — recipients will be bound to use the information only for the purposes for which we collected it, and you'll be notified before your information becomes subject to a different privacy policy.

### 4.5 We do not sell your personal information

We do not sell personal information, and we do not share it with third parties for their own marketing.

---

## 5. AI features

Tradespeople with an active **Blue Seal Pro** subscription (or trial) can use the AI assistant — to diagnose problems, draft quotes and invoice notes, summarize jobs, and suggest replies — from inside a job. Receipt-scanning (which reads an uploaded receipt image to pre-fill an expense) is available to all tradespeople. When a tradesperson uses these AI features:

- We send the relevant context (for job-scoped help: chat messages, intake-form answers, and intake/job photos for that job; for receipt-scanning: the receipt image) to Google's Gemini model via **Google Vertex AI**.
- Google processes this data to generate the response and, under our agreement with Google, **does not use it to train its general models**.
- We log the feature used, token counts and timestamp for usage limits and abuse prevention (we don't log the raw inputs and outputs beyond what's necessary for support).

Clients should be aware that chat messages and photos they send to a tradesperson **may be processed by AI** in this way if the tradesperson uses an AI tool on that job. By using the Service, you consent to this processing for the purpose of producing tools for the tradesperson assigned to your job.

---

## 6. How long we keep information (retention)

We keep personal information only as long as necessary for the purposes set out above and to meet legal obligations.

| Data | Retention |
|---|---|
| Account record | While your account is active; if you delete your account, we deactivate it immediately and erase or anonymize it within **90 days**, subject to the exceptions below |
| **Government-issued ID images** (tradespeople) | **Auto-deleted 90 days after vetting approval** — we no longer need the image once you're verified |
| Trade certification documents | While your account is active and you remain a tradesperson, plus 2 years (to support disputes about work qualifications) |
| Jobs, chats, invoices | 7 years after job completion (to support tax records, disputes and contractual obligations) |
| Public reviews | Until you delete your account or the review is removed for policy violation |
| Private client reviews | 5 years after creation |
| Audit logs (admin actions) | 7 years |
| Server logs, analytics | 13 months by default |

Where we are required by law to retain information longer than the periods above, we will do so for the legally required period only.

---

## 7. Your rights and how to exercise them

You have the following rights regarding your personal information held by Blue Seal:

- **Access** — request a copy of the personal information we hold about you;
- **Correction** — ask us to correct information that is inaccurate or incomplete;
- **Withdraw consent** — withdraw your consent to our use or disclosure of your personal information, subject to legal or contractual restrictions and reasonable notice (this may prevent us from continuing to provide the Service);
- **Deletion** — ask us to delete your account and associated personal information, subject to the retention exceptions in § 6;
- **Marketing opt-out** — unsubscribe from any marketing email using the link in the email, or by emailing contact@blueseal.app;
- **Complain to a regulator** — if you believe we have not handled your personal information properly, you can complain to the Office of the Privacy Commissioner of Canada (priv.gc.ca) and, if you live in BC, to the Office of the Information and Privacy Commissioner for British Columbia (oipc.bc.ca).

Most rights can be exercised from inside your account settings. For anything you can't do in-app, email **contact@blueseal.app**. We will respond within **30 days**. To protect your information, we may need to verify your identity before acting on a request.

We may decline a request where the law allows (e.g., requests that would reveal a third party's personal information, are unfounded or excessive, or relate to information we are legally required to keep). If we decline, we will explain why and how you can challenge our decision.

---

## 8. How we protect your information

We use technical and organizational safeguards appropriate to the sensitivity of the information, including:

- TLS encryption in transit for all traffic between your device and the Service;
- Encryption at rest for stored files (provided by Google Cloud / Firebase Storage);
- Server-enforced security rules that **default-deny** access to every Firestore collection and Storage path;
- Role-based access controls — only administrators can view government-IDs, and only during vetting;
- App Check on all backend callables to block traffic from non-authentic clients;
- Audit logging of administrator actions;
- Hashing of passwords by Firebase Authentication (we never see your plain-text password);
- Periodic security review of our codebase and dependencies.

No security control is perfect. If we become aware of a breach affecting your personal information that creates a real risk of significant harm, we will notify you and the relevant regulator(s) as required under PIPEDA and PIPA BC.

---

## 9. Cookies and similar technologies

We use a small number of cookies and similar technologies (`localStorage`, `sessionStorage`, IndexedDB):

- **Strictly necessary** — to keep you signed in, remember your role, and maintain session security. These cannot be disabled.
- **Functional** — to remember preferences such as your last search filters.
- **Analytics** — to understand how the Service is used in aggregate. Where required by law, we ask for your consent before loading analytics.

You can clear cookies in your browser at any time; doing so will sign you out.

---

## 10. Children

The Service is not intended for, and we do not knowingly collect personal information from, anyone under the age of majority in their province of residence (19 in BC). If you believe a child has provided us with personal information, please contact us at contact@blueseal.app and we will delete it.

---

## 11. International users

Blue Seal operates from Canada. Our service providers process data in the United States and other countries (see § 4.2). By using the Service from outside Canada, you understand that your personal information will be transferred to and processed in Canada and in the countries where our service providers operate.

We do not currently target users in the European Economic Area, the United Kingdom or Switzerland. If you are located in one of these regions and choose to use the Service, you do so on your own initiative and you acknowledge that we will rely on the lawful bases described in § 3.

---

## 12. Changes to this Privacy Policy

We may update this Privacy Policy from time to time. When we make material changes we will:

- update the "Last updated" date at the top of this page;
- post a notice on the Service; and
- where the change affects how we use information you've already given us, request renewed consent before the change takes effect for you.

Non-material changes (typos, clarifications, contact updates) may be made without notice.

---

## 13. How to contact us

For privacy questions, requests under § 7, or complaints:

**Blue Seal — Privacy Officer** (Blue Seal is operated as a sole proprietorship by **James Jansen**)
**Email:** contact@blueseal.app
**Mailing address:** 6960 Terazona Drive, Kelowna, BC, Canada V1Z 3R8

For general support questions, the same address works: contact@blueseal.app.

*(Before publishing, replace `[OPERATOR LEGAL NAME]` with the registered name the Blue Seal sole proprietorship operates under.)*
