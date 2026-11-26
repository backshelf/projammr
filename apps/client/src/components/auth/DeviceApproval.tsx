"use client";

import { authClient } from "@workspace/api/lib/auth-client";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Spinner } from "@workspace/ui/components/spinner";
import { useEffect, useRef, useState } from "react";

type View =
  | { kind: "enter"; error?: string }
  | { kind: "checking" }
  | { kind: "review"; code: string; error?: string }
  | { kind: "done"; outcome: "approved" | "denied" };

type Decision = "approve" | "deny";

const UNREACHABLE = "Could not reach the server. Try again.";
const RATE_LIMITED = "Too many attempts. Wait a moment and try again.";

/** What the auth client hands back for a failed device request: the HTTP
 *  status and the OAuth style `error` / `error_description` pair the plugin
 *  throws. */
type DeviceError = {
  status?: number;
  error?: string;
  error_description?: string;
  message?: string;
} | null;

/** The code as the person reads it: the server compares exactly, and the
 *  codes it issues are upper case. */
const normalise = (code: string) => code.trim().toUpperCase();

/** A failed request that carried no usable body (a proxy's HTML page, a bare
 *  500) still reached the server, so it is not an unreachable-network error. */
const fallbackMessage = (error: DeviceError) =>
  error?.status === 429
    ? RATE_LIMITED
    : (error?.error_description ??
      error?.message ??
      (error?.status
        ? `Something went wrong (${error.status}). Try again.`
        : UNREACHABLE));

const lookupMessage = (error: DeviceError) =>
  error?.error === "expired_token"
    ? "That code has expired. Run dit login again for a new one."
    : error?.error === "invalid_request"
      ? "That code is not valid. Check it matches the one in your terminal."
      : error?.error === "access_denied"
        ? "That code was opened by a different account."
        : fallbackMessage(error);

/** Errors that no retry of the same code can clear: the code is gone, spent or
 *  held by another account. */
const isFinal = (error: DeviceError) =>
  error?.error === "expired_token" ||
  error?.error === "invalid_request" ||
  error?.error === "access_denied";

/** Looks a code up, which claims it for the signed-in caller, and says which
 *  view the answer belongs to. */
async function checkCode(raw: string): Promise<View> {
  const code = normalise(raw);
  try {
    const { data, error } = await authClient.device({
      query: { user_code: code },
    });
    if (error || !data) return { kind: "enter", error: lookupMessage(error) };
    if (data.status === "approved" || data.status === "denied") {
      return { kind: "done", outcome: data.status };
    }
    if (data.client_id === undefined) {
      return {
        kind: "enter",
        error: "That code was opened by a different account.",
      };
    }
    return { kind: "review", code };
  } catch {
    return { kind: "enter", error: UNREACHABLE };
  }
}

/**
 * The interactive half of `/device`: the code a `dit login` is showing, and
 * the Approve / Deny choice for it. Looking a code up claims it for the
 * signed-in caller on the server, so a second account cannot then approve it.
 * With a code from the URL the lookup runs on arrival; without one the person
 * types it from their terminal.
 */
export function DeviceApproval({ initialCode }: { initialCode?: string }) {
  const [view, setView] = useState<View>(
    initialCode ? { kind: "checking" } : { kind: "enter" }
  );
  const [typed, setTyped] = useState(initialCode ?? "");
  const [busy, setBusy] = useState<Decision | null>(null);

  const lookUp = (raw: string) => {
    setView({ kind: "checking" });
    void checkCode(raw).then(setView);
  };

  // A lookup spends a rate-limit token, so one mount looks a code up once
  // even when React runs the effect twice in development.
  const lookedUpRef = useRef<string | null>(null);

  useEffect(() => {
    // The view starts as "checking" when there is a code, so only the answer
    // is set here.
    if (!initialCode || lookedUpRef.current === initialCode) return;
    lookedUpRef.current = initialCode;
    void checkCode(initialCode).then(setView);
  }, [initialCode]);

  const decide = async (decision: Decision, code: string) => {
    setBusy(decision);
    try {
      const { error } =
        decision === "approve"
          ? await authClient.device.approve({ userCode: code })
          : await authClient.device.deny({ userCode: code });
      if (error) {
        const failure = error as DeviceError;
        // A final refusal may only mean the code was decided elsewhere, so
        // look it up again and let its real state pick the view.
        setView(
          isFinal(failure)
            ? await checkCode(code)
            : { kind: "review", code, error: fallbackMessage(failure) }
        );
      } else {
        setView({
          kind: "done",
          outcome: decision === "approve" ? "approved" : "denied",
        });
      }
    } catch {
      setView({ kind: "review", code, error: UNREACHABLE });
    }
    setBusy(null);
  };

  if (view.kind === "checking") {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-body text-ink-soft"
      >
        <Spinner />
        Checking the code…
      </p>
    );
  }

  if (view.kind === "done") {
    return (
      <p role="status" className="text-body text-ink">
        {view.outcome === "approved"
          ? "dit is signed in. You can close this tab."
          : "Denied. dit was not signed in. You can close this tab."}
      </p>
    );
  }

  if (view.kind === "review") {
    const { code } = view;
    return (
      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-body text-pretty text-ink-soft">
            dit is asking to sign in to your account.
          </p>
          <p className="font-mono text-subtitle text-ink tabular-nums">
            <span aria-hidden="true">{code}</span>
            <span className="sr-only">{code.split("").join(" ")}</span>
          </p>
          <p className="text-small text-pretty text-ink-soft">
            Check this matches the code in your terminal before you approve.
          </p>
        </div>
        {view.error && (
          <p role="alert" className="text-small text-danger">
            {view.error}
          </p>
        )}
        <div className="flex justify-center gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void decide("deny", code)}
          >
            {busy === "deny" && <Spinner />}
            Deny
          </Button>
          <Button
            type="button"
            disabled={busy !== null}
            onClick={() => void decide("approve", code)}
          >
            {busy === "approve" && <Spinner />}
            Approve
          </Button>
        </div>
      </div>
    );
  }

  const ready = normalise(typed) !== "";
  return (
    <form
      className="flex w-full flex-col gap-6 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void lookUp(typed);
      }}
    >
      <FieldGroup>
        <Field data-invalid={view.error ? true : undefined}>
          <FieldLabel htmlFor="device-code">Code</FieldLabel>
          <Input
            id="device-code"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={view.error ? true : undefined}
            aria-describedby="device-code-help"
            className="font-mono uppercase"
          />
          <FieldDescription id="device-code-help">
            The code dit shows in your terminal.
          </FieldDescription>
          {view.error && <FieldError role="alert">{view.error}</FieldError>}
        </Field>
      </FieldGroup>
      <div className="flex justify-center">
        <Button type="submit" disabled={!ready}>
          Continue
        </Button>
      </div>
    </form>
  );
}
