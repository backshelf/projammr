import { useEffect, useId, useState, type JSX, type SubmitEvent } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldLabel } from "@workspace/ui/components/field";

import { call } from "../bridge";
import { ErrorLine } from "../error-line";
import type { Auth } from "../ipc";
import { PanelHead } from "../panel-head";
import { PanelInput } from "../panel-input";
import { useFocusTarget } from "../focus-target";
import { useCommand } from "../use-command";

/** What the head says of each state before the person is signed in; the waiting state speaks in the body. */
function ledeOf(auth: Auth): string | null {
  switch (auth.state) {
    case "signed-out":
      return "Not signed in.";
    case "revoked":
      return `Signed out of ${auth.host ?? "the instance"}. Sign in to keep pushing.`;
    case "keychain-locked":
      return "dit can't read its sign-in from the Keychain.";
    case "signing-in":
    case "signed-in":
      return null;
  }
}

/**
 * Every state before the machine is signed in: the instance address and Sign in, the device grant's wait with its
 * code and Open again, and the two reasons a sign-in that existed is gone. Approval happens in the browser; this
 * screen never sees a credential.
 */
export function SignIn({ auth }: { auth: Auth }): JSX.Element {
  const waiting = auth.state === "signing-in";

  return (
    <div className="flex flex-col gap-4">
      <PanelHead title="Sign in" lede={ledeOf(auth)} signedIn={false} />
      {waiting ? <Waiting auth={auth} /> : <InstanceForm auth={auth} />}
    </div>
  );
}

function InstanceForm({ auth }: { auth: Auth }): JSX.Element {
  const id = useId();
  const [host, setHost] = useState(auth.host ?? "");
  const focusTarget = useFocusTarget();
  const { run, pending, error } = useCommand();

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const trimmed = host.trim();
    void run(() => call("sign_in", { host: trimmed === "" ? null : trimmed }));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor={id}>Instance</FieldLabel>
        <PanelInput
          id={id}
          value={host}
          onChange={(event) => setHost(event.target.value)}
          placeholder="https://projammr.example"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error !== null || undefined}
          ref={focusTarget}
          className="font-mono text-small"
        />
      </Field>
      <ErrorLine error={error} />
      <Button type="submit" size="lg" disabled={pending} className="self-start">
        Sign in
      </Button>
    </form>
  );
}

function Waiting({ auth }: { auth: Auth }): JSX.Element {
  const { run, pending, error } = useCommand();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyCode(): Promise<void> {
    const code = auth.pending?.userCode;
    if (!code) return;
    await navigator.clipboard?.writeText(code);
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-ink">
        Approve this computer in your browser.
      </p>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <p
            aria-label="Code"
            className="font-mono text-subtitle/none tracking-[0.12em] text-ink"
          >
            {auth.pending?.userCode}
          </p>
          <Button
            variant="ghost"
            disabled={!auth.pending?.userCode}
            onClick={() => void copyCode()}
          >
            {copied ? (
              <>
                <IconCheck aria-hidden className="size-3.5 text-art" />
                Copied
              </>
            ) : (
              <>
                <IconCopy aria-hidden className="size-3.5" />
                Copy code
              </>
            )}
          </Button>
        </div>
        <p className="truncate text-micro text-ink-soft">
          {auth.pending?.verificationUri}
        </p>
      </div>
      <ErrorLine error={error} />
      <div className="flex items-center gap-2">
        <Button
          size="lg"
          variant="outline"
          disabled={pending}
          onClick={() => void run(() => call("sign_in", { host: auth.host }))}
        >
          Open again
        </Button>
        <Button
          size="lg"
          variant="ghost"
          disabled={pending}
          onClick={() => void run(() => call("cancel_sign_in"))}
        >
          Cancel
        </Button>
      </div>
      <p role="status" className="text-small text-ink-soft">
        {"Waiting for approval\u2026"}
      </p>
    </div>
  );
}
