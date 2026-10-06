import { createFileRoute } from "@tanstack/react-router";

/**
 * The privacy policy, at a stable public URL.
 *
 * Required by Google to publish the OAuth consent screen out of test mode, and
 * linked from that screen -- so the people reading it are clients deciding
 * whether to connect their Google account, and Google reviewers. It renders
 * standalone rather than inside AppShell for that reason: it is a document
 * anyone can open, not a screen of the app.
 *
 * Everything in it is checked against the code. If a claim here stops being
 * true, the claim is the bug.
 */

/**
 * Where someone writes in about their own data.
 *
 * Public by design: it is linked from the Google consent screen and is the only
 * way a reader has to reach a person, so it has to be an address that is
 * actually read.
 */
const CONTACT_EMAIL = "ccblue241@gmail.com";

const UPDATED = "5 October 2026";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy — Trakt" },
      {
        name: "description",
        content:
          "Trakt keeps your training data on your own device. No user database, no tracking.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl bg-background px-6 py-12 text-ink">
      <h1 className="t-title">Privacy</h1>
      <p className="pb-6 t-label text-ink-2">Last updated {UPDATED}</p>

      <Callout>
        Trakt keeps your workout and fitness data on your own device. If you turn on the optional
        Google Sheet, a copy goes to a spreadsheet in your own Google Drive that you own and can
        delete. The backend handles session authentication credentials to keep your sheet connected;
        it never receives your workout logs, bodyweight, or personal entries.
      </Callout>

      <Section title="What Trakt stores, and where">
        <P>
          Trakt records your bodyweight, calories, protein, carbs, fat, steps, and the workouts you
          log. All of it is written to storage inside your own browser or phone, in the app itself.
        </P>
        <P>
          Trakt has no separate account registration, central workout database, or analytics. Your
          fitness data is not uploaded to Trakt&rsquo;s servers.
        </P>
        <P>
          Because the data lives on your device, clearing your browser&rsquo;s site data or deleting
          the app deletes it. Export a JSON backup in Settings before you change phones; your Google
          Sheet, if connected, also retains the data you have synced.
        </P>
      </Section>

      <Section title="Your Google connection">
        <P>
          Trakt can mirror your log into a Google Sheet. It is off until you turn it on, and the app
          works completely without it.
        </P>
        <P>
          When you connect it, Trakt asks Google for one permission: <Code>drive.file</Code>, which
          Google describes as access to &ldquo;only the specific Google Drive files you use with
          this app&rdquo;. Trakt can access the spreadsheet it creates and files you explicitly
          choose through Google Picker, such as a client&rsquo;s shared sheet. It does not request
          access to the rest of your Drive.
        </P>
        <P>
          The spreadsheet lives in <em>your</em> Google Drive, under your Google account. You own
          it, you can open it, and you can delete it at any time. Google&rsquo;s own privacy policy
          covers what they do with files in your Drive.
        </P>
        <P>
          To keep you connected between visits, Trakt&rsquo;s server exchanges your Google sign-in
          code and renews access when it expires. It stores the refresh credential in an encrypted,
          HttpOnly cookie that browser scripts cannot read. This cookie lasts up to 90 days and
          renews when your connection is used. Short-lived access tokens stay in browser memory.
          Neither credential is included in backup exports.
        </P>
        <P>
          Disconnecting in Settings clears this browser&rsquo;s connection without deleting your
          logs, your spreadsheet, or connections on other devices. If you disconnect offline, a
          local marker prevents automatic reconnection until you deliberately sign in again. To
          revoke Trakt&rsquo;s Google access everywhere, remove it from your Google account&rsquo;s
          third-party connections. Google may also require you to reconnect after revocation or
          expiry.
        </P>
      </Section>

      <Section title="If you have a coach">
        <P>
          Trakt lets a coach write your nutrition and training plan, and read the log you have
          already chosen to sync.
        </P>
        <P>
          That works entirely through Google Drive sharing, which you control. A coach can see your
          data only if you share your spreadsheet with them, and only for as long as you leave it
          shared. Revoking access in Google Drive revokes it in Trakt, because it is the same
          permission. Trakt holds no separate list of who may see your data.
        </P>
        <P>
          A plan your coach sends is never applied silently. Trakt shows you what would change and
          you decide whether to accept it.
        </P>
      </Section>

      <Section title="What Trakt does not do">
        <List
          items={[
            "No analytics, tracking pixels, or usage statistics of any kind.",
            "No advertising, and no sharing or selling of data to anyone.",
            "No external fonts. Google scripts load when you use the Google connection or file-selection features.",
            "No third-party crash reporting. Hosting infrastructure may retain ordinary request and server error logs; authentication credentials are not logged by the session endpoints.",
            "No advertising or tracking cookies. The Google connection cookie is used only to keep your authorized session working.",
          ]}
        />
      </Section>

      <Section title="Google API Services User Data Policy">
        <P>
          Trakt&rsquo;s use of information received from Google APIs follows the{" "}
          <A href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </A>
          , including its Limited Use requirements.
        </P>
        <P>
          In practice: data from your Google account is used only to provide the sheet-sync feature
          you turned on. It is not sold or used for advertising. Your fitness records travel
          directly between your device and Google; the session server handles only the credentials
          needed for that connection.
        </P>
      </Section>

      <Section title="Deleting everything">
        <List
          items={[
            "In Trakt: Settings has a reset that clears the data on your device.",
            "The spreadsheet: delete it in Google Drive like any other file.",
            "The connection: disconnect in Settings, and remove Trakt at myaccount.google.com under Third-party apps.",
          ]}
        />
        <P>
          There is nothing else to delete, and no request to send anyone, because no copy of your
          data exists anywhere else.
        </P>
      </Section>

      <Section title="Children">
        <P>Trakt is not intended for use by children under 13.</P>
      </Section>

      <Section title="Changes and contact">
        <P>
          If this policy changes, the date at the top changes with it. Questions about your data:{" "}
          <A href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</A>.
        </P>
      </Section>
    </main>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-8 border border-rule px-4 py-4 t-body text-ink rounded-md">{children}</div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pb-8">
      <h2 className="pb-2 t-caption text-ink">{title}</h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="pb-3 t-body text-ink-2">{children}</p>;
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 pb-3">
      {items.map((item) => (
        <li key={item} className="flex gap-2 t-body text-ink-2">
          <span aria-hidden="true" className="text-ink-3">
            —
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="bg-rule px-1 py-0.5 t-label text-ink rounded-md">{children}</code>;
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="text-ink underline" target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
