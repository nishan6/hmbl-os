"use client";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Alert } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useForm } from "@/components/ui/use-form";
import { savePreferencesAction } from "../actions";

type Pref = { kind: string; label: string; inApp: boolean; email: boolean };

export function PreferencesForm({ prefs, emailReady }: { prefs: Pref[]; emailReady: boolean }) {
  const f = useForm(savePreferencesAction);
  return (
    <form action={f.action} key={f.formKey} className="flex max-w-3xl flex-col gap-4">
      <FormAlert {...f} title="Your settings weren't saved" />
      {!emailReady ? (
        <Alert tone="info" title="Email isn't set up yet">
          You can choose email now. Nothing is sent until email is set up, and each email is
          recorded as not sent until then.
        </Alert>
      ) : null}
      <Table dense>
        <THead>
          <tr>
            <TH>Notification</TH>
            <TH align="center">In the app</TH>
            <TH align="center">Email</TH>
          </tr>
        </THead>
        <TBody>
          {prefs.map((p) => (
            <TR key={p.kind}>
              <TD>{p.label}</TD>
              <TD align="center">
                <input
                  type="checkbox"
                  name={`inApp:${p.kind}`}
                  defaultChecked={p.inApp}
                  aria-label={`${p.label}: in the app`}
                />
              </TD>
              <TD align="center">
                <input
                  type="checkbox"
                  name={`email:${p.kind}`}
                  defaultChecked={p.email}
                  aria-label={`${p.label}: email`}
                />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
