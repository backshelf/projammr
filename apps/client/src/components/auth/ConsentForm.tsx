"use client";

import { consentChoices, grantedScope } from "@/lib/consent-scopes";
import { useBrand } from "@/lib/brand-context";
import { authClient } from "@workspace/api/lib/auth-client";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@workspace/ui/components/field";
import { Spinner } from "@workspace/ui/components/spinner";
import { useEffect, useState } from "react";

const SCOPE_LABEL: Record<string, string> = {
  read: "Read",
  write: "Write",
  offline_access: "Stay connected",
};

const SCOPE_DESCRIPTION: Record<string, string> = {
  read: "View your projects, collections, tracks and sessions.",
  write: "Create and edit your projects, collections, tracks and sessions.",
  offline_access:
    "Refresh its connection automatically in the background without asking you to sign in every day.",
};

/**
 * The interactive half of `/consent`: a checkbox per requested scope and the
 * Allow/Deny actions. Submitting posts straight through the shared
 * `authClient`, whose `oauthProviderClient()` plugin signs the page's own
 * query string onto the request as `oauth_query` — the provider reads that
 * to know which authorization request this answers.
 */
export function ConsentForm({
  clientId,
  scope,
  claims,
}: {
  clientId: string;
  scope: string;
  claims: string | undefined;
}) {
  const brand = useBrand();
  const [clientName, setClientName] = useState(clientId);
  const { fixed, optional } = consentChoices(scope);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(optional));
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authClient.oauth2
      .publicClient({ query: { client_id: clientId } })
      .then(({ data }) => {
        if (!cancelled && data?.client_name) setClientName(data.client_name);
      })
      .catch(() => {
        // An unknown client or one with no name: the client_id already
        // shown identifies it.
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const respond = async (accept: boolean) => {
    setBusy(accept ? "allow" : "deny");
    setError(null);
    const { data, error: consentError } = await authClient.oauth2.consent({
      accept,
      scope: accept ? grantedScope(scope, ticked) : undefined,
      claims,
    });
    if (data?.url) {
      window.location.href = data.url;
      return;
    }
    setBusy(null);
    setError(
      consentError?.message ?? `Could not reach ${brand.name}. Try again.`
    );
  };

  return (
    <div className="flex w-full flex-col gap-6 text-left">
      <p className="text-body text-ink-soft">
        <span className="text-ink">{clientName}</span> wants to connect to your{" "}
        {brand.name} account.
      </p>
      <FieldSet>
        <FieldGroup>
          {[...fixed, ...optional].map((s) => {
            const id = `consent-scope-${s}`;
            const isFixed = fixed.includes(s);
            return (
              <Field key={s} orientation="horizontal">
                <Checkbox
                  id={id}
                  checked={isFixed || ticked.has(s)}
                  disabled={isFixed}
                  onChange={(e) =>
                    setTicked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(s);
                      else next.delete(s);
                      return next;
                    })
                  }
                />
                <FieldContent>
                  <FieldLabel htmlFor={id}>{SCOPE_LABEL[s] ?? s}</FieldLabel>
                  <FieldDescription>
                    {isFixed
                      ? `${SCOPE_DESCRIPTION[s] ?? ""} Always granted.`.trim()
                      : (SCOPE_DESCRIPTION[s] ?? "")}
                  </FieldDescription>
                </FieldContent>
              </Field>
            );
          })}
        </FieldGroup>
      </FieldSet>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-center gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => respond(false)}
        >
          {busy === "deny" && <Spinner />}
          Deny
        </Button>
        <Button
          type="button"
          disabled={busy !== null}
          onClick={() => respond(true)}
        >
          {busy === "allow" && <Spinner />}
          Allow
        </Button>
      </div>
    </div>
  );
}
