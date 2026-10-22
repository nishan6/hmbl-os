import { Brand } from "@/components/shell/brand";
import { SignOutLink } from "./sign-out-link";
import { TwoFactorSetup } from "./two-factor-setup";

/** Shown instead of the app to users whose role requires two-factor until they set it up. */
export function TwoFactorRequired({ name }: { name: string }) {
  return (
    <main id="main" className="flex flex-1 justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center justify-between">
          <Brand href={null} />
          <SignOutLink />
        </div>
        <div className="border-separator bg-surface rounded-lg border p-6 shadow-md">
          <h1 className="text-text text-lg font-semibold tracking-tight">
            Set up two-factor sign-in
          </h1>
          <p className="text-secondary mt-1 mb-6 text-base">
            {name.split(" ")[0]}, your role can approve payments or change who has access, so it
            needs a second step when you sign in. This takes about two minutes.
          </p>
          <TwoFactorSetup doneHref="/" />
        </div>
      </div>
    </main>
  );
}
