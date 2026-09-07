/**
 * Static, dependency-free fallback shown when boot configuration is invalid
 * (Spec 04.0 §6.2 / §9, AC2). No router, no Auth0, no network — it must render
 * even when nothing else can, so `#root` is never left blank.
 */
export function Misconfigured() {
  return (
    <main>
      <h1>This app is not set up right</h1>
      <p>
        strength-in-numbers is missing configuration it needs to start. If you
        are the developer, check the <code>VITE_*</code> build variables against{" "}
        <code>apps/web/.env.example</code>. Otherwise, please try again later.
      </p>
    </main>
  );
}
