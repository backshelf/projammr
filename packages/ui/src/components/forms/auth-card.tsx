"use client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  AuthCardGuest,
  AuthCardRegister,
  AuthCardSignIn,
  type AuthCardEmailProps,
  type AuthCardRegisterProps,
  type AuthCardSignInProps,
} from "@workspace/ui/components/forms/auth-card-tabs";
import { GuestForm } from "@workspace/ui/components/forms/guest-card";
import { LoginForm } from "@workspace/ui/components/forms/login-card";
import { RegisterForm } from "@workspace/ui/components/forms/register-card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { AuthSuccess } from "@workspace/ui/lib/auth-forms";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

const TAB_COLUMNS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
};

export type AuthCardProps = {
  onSuccess?: (data: AuthSuccess) => void;
  /** Overrides the derived heading, for a caller reading the instance's own
   *  state (first account, closed registration). */
  title?: string;
  /** Overrides the description derived from the tabs on offer. */
  description?: string;
  /** `AuthCard.Guest`, `AuthCard.SignIn` and `AuthCard.Register`, in tab
   *  order; the first is selected. */
  children: ReactNode;
};

type Tab = { kind: "guest" | "signin" | "register"; label: string };

const lockedEmail = ({ defaultEmail, lockEmail }: AuthCardEmailProps) => ({
  defaultEmail,
  lockEmail: Boolean(defaultEmail && lockEmail),
});

const headingFor = (kinds: Tab["kind"][]) => {
  if (!kinds.includes("register")) {
    return "Sign in";
  }
  return kinds.length === 1
    ? "Create an account"
    : "Sign in or create an account";
};

const OFFERS: [Tab["kind"], string][] = [
  ["signin", "sign in"],
  ["register", "create an account"],
  ["guest", "continue as a guest"],
];

/** One phrase per tab on offer, as a sentence. Without a guest tab it ends
 *  "to get started", which continuing as a guest already says. */
const descriptionFor = (kinds: Tab["kind"][]) => {
  const offers = OFFERS.filter(([kind]) => kinds.includes(kind)).map(
    ([, phrase]) => phrase
  );
  const last = offers.pop()!;
  const list = offers.length === 0 ? last : `${offers.join(", ")}, or ${last}`;
  const sentence = kinds.includes("guest") ? list : `${list} to get started`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
};

const AuthCardRoot = ({
  onSuccess,
  title,
  description,
  children,
}: AuthCardProps) => {
  // eslint-disable-next-line @eslint-react/no-children-to-array -- the tab list is the children's own order and identity, and toArray also drops absent children
  const tabs = Children.toArray(children).map((child) => {
    if (isValidElement(child)) {
      const { type, props } = child as ReactElement<AuthCardSignInProps>;
      if (type === AuthCardGuest) {
        return {
          kind: "guest",
          label: "Guest",
          form: <GuestForm onSuccess={onSuccess} />,
        } as const;
      }
      if (type === AuthCardSignIn) {
        return {
          kind: "signin",
          label: "Sign in",
          form: (
            <LoginForm
              onSuccess={onSuccess}
              recovery={props.recovery}
              {...lockedEmail(props)}
            />
          ),
        } as const;
      }
      if (type === AuthCardRegister) {
        const { passwordRule } = props as AuthCardRegisterProps;
        return {
          kind: "register",
          label: "Register",
          form: (
            <RegisterForm
              onSuccess={onSuccess}
              passwordRule={passwordRule}
              {...lockedEmail(props)}
            />
          ),
        } as const;
      }
    }
    throw new Error(
      "AuthCard children must be AuthCard.Guest, AuthCard.SignIn or AuthCard.Register elements"
    );
  });

  if (tabs.length === 0) {
    throw new Error("AuthCard needs at least one of its tab children");
  }
  const kinds = tabs.map((tab) => tab.kind);
  if (new Set(kinds).size !== tabs.length) {
    throw new Error("AuthCard takes each tab child at most once");
  }

  return (
    <Card className={"w-full max-w-sm"}>
      <CardHeader>
        <CardTitle
          asChild
          className={"font-heading text-subtitle/[1.1] text-ink"}
        >
          <h2>{title ?? headingFor(kinds)}</h2>
        </CardTitle>
        <CardDescription>
          {description ?? descriptionFor(kinds)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={tabs[0]?.kind}>
          {tabs.length > 1 && (
            <TabsList
              className={`mb-4 grid w-full ${TAB_COLUMNS[tabs.length]}`}
            >
              {tabs.map((tab) => (
                <TabsTrigger key={tab.kind} value={tab.kind}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          )}
          {tabs.map((tab) => (
            <TabsContent key={tab.kind} value={tab.kind}>
              {tab.form}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
};

export const AuthCard = Object.assign(AuthCardRoot, {
  Guest: AuthCardGuest,
  SignIn: AuthCardSignIn,
  Register: AuthCardRegister,
});
