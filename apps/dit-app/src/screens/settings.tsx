import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
} from "react";
import { IconArrowUpRight } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { useFormat } from "@workspace/ui/components/format-provider";
import { Switch } from "@workspace/ui/components/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { cn } from "@workspace/ui/lib/utils";

import { call } from "../bridge";
import { ErrorLine } from "../error-line";
import type {
  SettingChange,
  Settings as SettingsValues,
  Snapshot,
  WritableSettingKey,
} from "../ipc";
import type { SettingsTab } from "../panel-actions";
import { PanelHead } from "../panel-head";
import { PanelInput } from "../panel-input";
import { ForgetList } from "../settings/forget-list";
import { PathList } from "../settings/path-list";
import { humanizeFingerprint, shortenHome } from "../settings/paths";
import { SettingRow } from "../settings/setting-row";
import { ShortcutRecorder } from "../settings/shortcut-recorder";
import { useCommand } from "../use-command";

/**
 * Sends one setting to the app and keeps the line for why it was refused. The control shows what the app says the
 * setting is, so a refused change leaves the control where it was.
 */
function useSetting<K extends WritableSettingKey>(
  key: K
): {
  set: (value: SettingsValues[K]) => Promise<boolean>;
  error: string | null;
} {
  const { run, error } = useCommand();
  const set = useCallback(
    (value: SettingsValues[K]) =>
      run(() => call("set_setting", { key, value } as SettingChange)),
    [run, key]
  );
  return { set, error };
}

/** Everything the app lets the person change, grouped into three compact tabs inside the 400px popover. */
export function Settings({
  snapshot,
  initialTab = "general",
  flushTop = true,
}: {
  snapshot: Pick<
    Snapshot,
    "auth" | "machine" | "settings" | "script" | "permissions"
  >;
  initialTab?: SettingsTab;
  flushTop?: boolean;
}): JSX.Element {
  const { settings } = snapshot;
  const [tabState, setTabState] = useState<{
    initial: SettingsTab;
    tab: SettingsTab;
  }>({ initial: initialTab, tab: initialTab });
  const tab = tabState.initial === initialTab ? tabState.tab : initialTab;
  const ignoredCount =
    settings.rejectedFiles.length + settings.neverHereFolders.length;

  return (
    <Tabs
      value={tab}
      onValueChange={(next) =>
        setTabState({ initial: initialTab, tab: next as SettingsTab })
      }
      className="flex flex-col gap-3"
    >
      <div
        className={cn(
          "sticky top-0 z-10 -mx-4 flex flex-col gap-2 border-b border-rule bg-paper px-4",
          flushTop ? "-mt-4 pt-4" : "pt-1"
        )}
      >
        <PanelHead title="Settings" back />
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="general" className="flex-none px-2.5">
            General
          </TabsTrigger>
          <TabsTrigger value="bounces" className="flex-none px-2.5">
            Bounces
          </TabsTrigger>
          <TabsTrigger value="live" className="flex-none px-2.5">
            Live
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="general" className="flex flex-col">
        <InstanceStrip
          host={snapshot.auth.host}
          appVersion={settings.appVersion}
        />
        <MachineNameSetting
          name={settings.machineName}
          registered={snapshot.machine.name}
        />
        <AutostartSetting autostart={settings.autostart} />
        <ShortcutSetting
          shortcut={settings.shortcut}
          error={settings.shortcutError}
        />
        <CliSetting installedAt={settings.cliInstalled} />
      </TabsContent>

      <TabsContent value="bounces" className="flex flex-col">
        <MaxUploadSetting megabytes={settings.maxUploadMb} />
        <FoldersSetting
          settingKey="watchRoots"
          label="Watch for bounces in"
          paths={settings.watchRoots}
          home={settings.home}
          emptyNotice="Watching entire home folder (~/). Add folders to narrow where dit looks."
        />
        <ExcludedSetting
          builtIn={settings.builtInExcluded}
          paths={settings.excluded}
          home={settings.home}
        />
        <IgnoredDisclosure
          count={ignoredCount}
          host={snapshot.auth.host}
          files={settings.rejectedFiles}
          folders={settings.neverHereFolders}
          home={settings.home}
        />
      </TabsContent>

      <TabsContent value="live" className="flex flex-col">
        <ScriptSetting script={snapshot.script} home={settings.home} />
        <PermissionsSetting
          screenRecording={snapshot.permissions.screenRecording}
        />
      </TabsContent>
    </Tabs>
  );
}

function InstanceStrip({
  host,
  appVersion,
}: {
  host: string | null;
  appVersion: string;
}): JSX.Element {
  const { run, error } = useCommand();

  return (
    <div className="flex flex-col gap-1 border-b border-rule pb-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-small text-ink">
          {host ?? "None"}
        </span>
        <span className="shrink-0 font-mono text-micro text-ink-faint tabular-nums">
          v{appVersion}
        </span>
      </div>
      {host !== null && (
        <Button
          variant="link"
          className="-ml-1 h-auto gap-0.5 self-start px-1 py-0 text-micro text-ink-soft hover:text-ink"
          onClick={() =>
            void run(() => call("open_web", { path: "/settings/devices" }))
          }
        >
          Devices on web
          <IconArrowUpRight aria-hidden className="size-3" />
        </Button>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

const SAVED_MS = 2000;

function MachineNameSetting({
  name,
  registered,
}: {
  name: string;
  registered: string | null;
}): JSX.Element {
  const id = useId();
  const { set, error } = useSetting("machineName");
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const value = draft ?? name;

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  async function commit(): Promise<void> {
    const next = value.trim();
    if (draft === null || next === "" || next === name) {
      setDraft(null);
      return;
    }
    if (await set(next)) {
      setDraft(null);
      setSaved(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setSaved(false);
        timerRef.current = null;
      }, SAVED_MS);
    }
  }

  return (
    <SettingRow
      id={id}
      label="Machine name"
      labelFor={`${id}-input`}
      description="How this computer shows on the web and to your other machines."
      facts={
        <span className="inline-flex items-center gap-2">
          <span>
            {registered === null
              ? "Not registered"
              : `Registered as ${registered}`}
          </span>
          {saved && (
            <span role="status" className="text-art">
              Saved
            </span>
          )}
        </span>
      }
      error={error}
    >
      <PanelInput
        id={`${id}-input`}
        value={value}
        onChange={(event) => {
          setSaved(false);
          setDraft(event.target.value);
        }}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
        }}
        spellCheck={false}
        aria-describedby={`${id}-description`}
      />
    </SettingRow>
  );
}

function AutostartSetting({ autostart }: { autostart: boolean }): JSX.Element {
  const id = useId();
  const { set, error } = useSetting("autostart");

  return (
    <SettingRow
      id={id}
      label="Start at login"
      labelFor={`${id}-switch`}
      description="Open dit when you log in, so no save goes unrecorded."
      control={
        <Switch
          id={`${id}-switch`}
          checked={autostart}
          onCheckedChange={(next) => void set(next)}
          aria-describedby={`${id}-description`}
        />
      }
      error={error}
    />
  );
}

function ShortcutSetting({
  shortcut,
  error: unregistered,
}: {
  shortcut: string | null;
  /** Why the app could not register `shortcut`, when it could not. */
  error: string | null;
}): JSX.Element {
  const id = useId();
  const { set, error } = useSetting("shortcut");
  const [refusal, setRefusal] = useState<string | null>(null);

  return (
    <SettingRow
      id={id}
      label="Global shortcut"
      description="Shows the panel from any app."
      control={
        <ShortcutRecorder
          id={`${id}-recorder`}
          accelerator={shortcut}
          onCapture={(accelerator) => void set(accelerator)}
          onClear={() => void set(null)}
          onRefusal={setRefusal}
          describedBy={`${id}-description`}
        />
      }
      error={refusal ?? error ?? unregistered}
    />
  );
}

/** A whole number of megabytes: digits only, so a stray unit or sign is refused rather than guessed at. */
const WHOLE_NUMBER = /^\d{1,9}$/;

function MaxUploadSetting({ megabytes }: { megabytes: number }): JSX.Element {
  const id = useId();
  const { set, error } = useSetting("maxUploadMb");
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const value = draft ?? String(megabytes);

  async function commit(): Promise<void> {
    if (draft === null) return;
    const next = draft.trim();
    if (!WHOLE_NUMBER.test(next)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (Number(next) === megabytes || (await set(Number(next)))) {
      setDraft(null);
    }
  }

  return (
    <SettingRow
      id={id}
      label="Max upload size"
      labelFor={`${id}-input`}
      description="The largest bounce dit uploads. 0 means no limit."
      error={
        invalid
          ? "Enter a whole number of megabytes, or 0 for no limit."
          : error
      }
      control={
        <div className="flex items-center gap-1.5">
          <PanelInput
            id={`${id}-input`}
            inputMode="numeric"
            value={value}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commit();
            }}
            aria-invalid={invalid || undefined}
            aria-describedby={`${id}-description ${id}-error`}
            className="w-16 text-right font-mono tabular-nums"
          />
          <span className="font-mono text-micro text-ink-soft">MB</span>
        </div>
      }
    />
  );
}

function FoldersSetting({
  settingKey,
  label,
  paths,
  home,
  emptyNotice,
  children,
}: {
  settingKey: "watchRoots" | "excluded";
  label: string;
  paths: string[];
  home: string;
  emptyNotice?: string;
  children?: JSX.Element | false;
}): JSX.Element {
  const id = useId();
  const { set, error } = useSetting(settingKey);
  const [pickError, setPickError] = useState<string | null>(null);

  return (
    <SettingRow id={id} label={label} error={pickError ?? error}>
      <PathList
        id={`${id}-add`}
        labelledBy={`${id}-label`}
        paths={paths}
        home={home}
        emptyNotice={emptyNotice}
        onChange={(next) => {
          setPickError(null);
          void set(next);
        }}
        onError={setPickError}
      />
      {children}
    </SettingRow>
  );
}

/** The person's excluded folders, with the built-in exclusions collapsed behind a disclosure. */
function ExcludedSetting({
  builtIn,
  paths,
  home,
}: {
  builtIn: string[];
  paths: string[];
  home: string;
}): JSX.Element {
  return (
    <FoldersSetting
      settingKey="excluded"
      label="Never look in"
      paths={paths}
      home={home}
    >
      {builtIn.length > 0 && (
        <Collapsible className="pt-1">
          <CollapsibleTrigger className="flex items-center gap-1.5 text-micro text-ink-soft hover:text-ink">
            <CollapsibleChevron />
            <span>
              {builtIn.length} built-in{" "}
              {builtIn.length === 1 ? "exclusion" : "exclusions"}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1.5">
            <p className="text-micro text-pretty text-ink-faint">
              Always skipped: {builtIn.join(", ")}.
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}
    </FoldersSetting>
  );
}

/** Collapsed disclosure holding files marked "Not a bounce" and folders marked "Never here". */
function IgnoredDisclosure({
  count,
  host,
  files,
  folders,
  home,
}: {
  count: number;
  host: string | null;
  files: SettingsValues["rejectedFiles"];
  folders: string[];
  home: string;
}): JSX.Element {
  const { run, error } = useCommand();

  return (
    <div className="border-t border-rule py-2.5">
      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-left text-small text-ink-soft hover:text-ink">
          <CollapsibleChevron />
          <span className="tabular-nums">
            Ignored bounces &amp; folders ({count})
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-3 pt-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <p className="text-micro text-pretty text-ink-soft">
              Not-a-bounce choices sync across devices.
            </p>
            {host !== null && (
              <Button
                variant="link"
                className="-ml-1 h-auto gap-0.5 px-1 py-0 text-micro text-ink-soft hover:text-ink"
                onClick={() =>
                  void run(() =>
                    call("open_web", { path: "/settings/devices" })
                  )
                }
              >
                Manage on web
                <IconArrowUpRight aria-hidden className="size-3" />
              </Button>
            )}
          </div>
          <ErrorLine error={error} />
          <RejectedFilesSetting files={files} home={home} />
          <NeverHereSetting folders={folders} home={home} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** The files marked "Not a bounce", each one to take back. */
function RejectedFilesSetting({
  files,
  home,
}: {
  files: SettingsValues["rejectedFiles"];
  home: string;
}): JSX.Element {
  const id = useId();
  const format = useFormat();
  const { run, error } = useCommand();
  const items = files.map((file) => ({
    key: file.fingerprint,
    title: file.name ?? humanizeFingerprint(file.fingerprint, format.bytes),
    rawTitle: file.name === null ? file.fingerprint : undefined,
    detail: file.folder ? shortenHome(file.folder, home) : null,
    rawDetail: file.folder,
  }));

  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-micro text-ink">
        Files marked Not a bounce
      </span>
      <ForgetList
        labelledBy={`${id}-label`}
        items={items}
        empty="No file is marked."
        onForget={(item) =>
          void run(() => call("forget_rejection", { fingerprint: item.key }))
        }
      />
      <ErrorLine error={error} />
    </div>
  );
}

/** The folders marked "Never here", each one to take back. */
function NeverHereSetting({
  folders,
  home,
}: {
  folders: string[];
  home: string;
}): JSX.Element {
  const id = useId();
  const { run, error } = useCommand();
  const items = folders.map((folder) => ({
    key: folder,
    title: shortenHome(folder, home),
    rawTitle: folder,
  }));

  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-micro text-ink">
        Folders marked Never here
      </span>
      <ForgetList
        labelledBy={`${id}-label`}
        items={items}
        empty="No folder is marked."
        onForget={(item) =>
          void run(() => call("forget_never_here", { folder: item.key }))
        }
      />
      <ErrorLine error={error} />
    </div>
  );
}

/** What the script row says for each state of the script, and what its button is called. */
function scriptRow(script: Snapshot["script"]): {
  facts: string;
  description: string;
  action: "Install" | "Reinstall";
} {
  switch (script.state) {
    case "connected":
      return {
        facts: `Connected${script.live ? ` · Live ${script.live}` : ""}`,
        description: "Tells dit which set is open and what changes in it.",
        action: "Reinstall",
      };
    case "installed":
      return {
        facts: "Installed · Not connected",
        description:
          "Live's dit script isn't enabled. Enable it in Live › Settings › Link, Tempo & MIDI for live changes.",
        action: "Reinstall",
      };
    case "not-installed":
      return {
        facts: "Not installed",
        description:
          "Install dit's script into Live's User Library, then enable it in Live › Settings › Link, Tempo & MIDI.",
        action: "Install",
      };
    case "live-not-found":
      return {
        facts: "Live wasn't found.",
        description:
          "dit puts its script in Live's User Library, so Live has to be installed first.",
        action: "Install",
      };
  }
}

function ScriptSetting({
  script,
  home,
}: {
  script: Snapshot["script"];
  home: string;
}): JSX.Element {
  const id = useId();
  const { run, pending, error } = useCommand();
  const { facts, description, action } = scriptRow(script);

  return (
    <SettingRow
      id={id}
      label="Live's dit script"
      description={description}
      facts={facts}
      control={
        <Button
          variant="outline"
          aria-label={`${action} Live's dit script`}
          disabled={pending}
          onClick={() => void run(() => call("install_script"))}
        >
          {action}
        </Button>
      }
      error={error}
    >
      {script.path !== null && (
        <p
          title={script.path}
          className="text-micro text-pretty [overflow-wrap:anywhere] text-ink-soft"
        >
          Installed at {shortenHome(script.path, home)}
        </p>
      )}
    </SettingRow>
  );
}

function CliSetting({
  installedAt,
}: {
  installedAt: string | null;
}): JSX.Element {
  const id = useId();
  const { run, pending, error } = useCommand();

  if (installedAt !== null) {
    return (
      <SettingRow
        id={id}
        label="Command-line tool"
        control={
          <span className="font-mono text-micro text-ink-soft">
            Installed at {installedAt}
          </span>
        }
        error={error}
      />
    );
  }

  return (
    <SettingRow
      id={id}
      label="Install the dit command"
      description="Links dit into /usr/local/bin so a terminal can run it. macOS asks for an administrator once."
      control={
        <Button
          variant="outline"
          aria-label="Install the dit command"
          disabled={pending}
          onClick={() => void run(() => call("install_cli"))}
        >
          Install
        </Button>
      }
      error={error}
    />
  );
}

function PermissionsSetting({
  screenRecording,
}: {
  screenRecording: boolean;
}): JSX.Element {
  const id = useId();
  const { run, pending, error } = useCommand();

  return (
    <SettingRow
      id={id}
      label="Permissions"
      description={
        <>
          {!screenRecording && (
            <>
              {
                "dit reads Live's window title to know which set is open when the script is off. Allow Screen Recording in System Settings. "
              }
            </>
          )}
          macOS asks before dit reads a file in Desktop, Documents or Downloads;
          say yes so bounces there are found.
        </>
      }
      facts={`Screen Recording: ${screenRecording ? "Allowed" : "Not allowed"}`}
      error={error}
    >
      {!screenRecording && (
        <Button
          variant="outline"
          aria-label="Open System Settings"
          disabled={pending}
          className="self-start"
          onClick={() => void run(() => call("request_screen_recording"))}
        >
          Open System Settings
        </Button>
      )}
    </SettingRow>
  );
}
