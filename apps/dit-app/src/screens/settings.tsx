import { useCallback, useId, useState, type JSX } from "react";
import { Button } from "@workspace/ui/components/button";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { Switch } from "@workspace/ui/components/switch";

import { call } from "../bridge";
import type { Settings as SettingsValues, Snapshot } from "../ipc";
import { PanelHead } from "../panel-head";
import { PanelInput } from "../panel-input";
import { ForgetList } from "../settings/forget-list";
import { PathList } from "../settings/path-list";
import { SettingRow } from "../settings/setting-row";
import { ShortcutRecorder } from "../settings/shortcut-recorder";
import { useCommand } from "../use-command";

/**
 * Sends one setting to the app and keeps the line for why it was refused. The control shows what the app says the
 * setting is, so a refused change leaves the control where it was.
 */
function useSetting<K extends keyof SettingsValues>(
  key: K
): {
  set: (value: SettingsValues[K]) => Promise<boolean>;
  error: string | null;
} {
  const { run, error } = useCommand();
  const set = useCallback(
    (value: SettingsValues[K]) =>
      run(() => call("set_setting", { key, value })),
    [run, key]
  );
  return { set, error };
}

/** Everything the app lets the person change, in the order they meet it: this computer, bounces, then Live. */
export function Settings({
  snapshot,
}: {
  snapshot: Pick<
    Snapshot,
    "auth" | "machine" | "settings" | "script" | "permissions"
  >;
}): JSX.Element {
  const { settings } = snapshot;

  return (
    <div className="flex flex-col gap-6">
      <PanelHead title="Settings" back />
      <section>
        <SectionHead>This computer</SectionHead>
        <MachineNameSetting
          name={settings.machineName}
          registered={snapshot.machine.name}
        />
        <InstanceSetting host={snapshot.auth.host} />
        <AutostartSetting autostart={settings.autostart} />
        <ShortcutSetting
          shortcut={settings.shortcut}
          error={settings.shortcutError}
        />
        <CliSetting installedAt={settings.cliInstalled} />
      </section>
      <section>
        <SectionHead>Bounces</SectionHead>
        <MaxUploadSetting megabytes={settings.maxUploadMb} />
        <FoldersSetting
          settingKey="watchRoots"
          label="Watch for bounces in"
          paths={settings.watchRoots}
        />
        <ExcludedSetting
          builtIn={settings.builtInExcluded}
          paths={settings.excluded}
        />
        <RejectedFilesSetting files={settings.rejectedFiles} />
        <NeverHereSetting folders={settings.neverHereFolders} />
      </section>
      <section>
        <SectionHead>Live</SectionHead>
        <ScriptSetting script={snapshot.script} />
        <PermissionsSetting
          screenRecording={snapshot.permissions.screenRecording}
        />
      </section>
    </div>
  );
}

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
  const value = draft ?? name;

  async function commit(): Promise<void> {
    const next = value.trim();
    if (draft === null || next === "" || next === name) {
      setDraft(null);
      return;
    }
    if (await set(next)) setDraft(null);
  }

  return (
    <SettingRow
      id={id}
      label="Machine name"
      labelFor={`${id}-input`}
      description="How this computer shows on the web and to your other machines."
      facts={
        registered === null ? "Not registered" : `Registered as ${registered}`
      }
      error={error}
    >
      <PanelInput
        id={`${id}-input`}
        value={value}
        onChange={(event) => setDraft(event.target.value)}
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

function InstanceSetting({ host }: { host: string | null }): JSX.Element {
  const id = useId();
  return (
    <SettingRow id={id} label="Instance">
      <p className="font-mono text-small break-all text-ink">
        {host ?? "None"}
      </p>
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
      label="Max upload size (MB)"
      labelFor={`${id}-input`}
      description="The largest bounce dit uploads. 0 means no limit."
      error={
        invalid
          ? "Enter a whole number of megabytes, or 0 for no limit."
          : error
      }
      control={
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
          className="w-20 text-right font-mono tabular-nums"
        />
      }
    />
  );
}

function FoldersSetting({
  settingKey,
  label,
  paths,
  description,
}: {
  settingKey: "watchRoots" | "excluded";
  label: string;
  paths: string[];
  description?: string;
}): JSX.Element {
  const id = useId();
  const { set, error } = useSetting(settingKey);

  return (
    <SettingRow id={id} label={label} description={description} error={error}>
      <PathList
        id={`${id}-add`}
        labelledBy={`${id}-label`}
        paths={paths}
        onChange={(next) => void set(next)}
      />
    </SettingRow>
  );
}

/** The built-in exclusions, shown and fixed, then the person's own beside them: what the render watcher never looks in. */
function ExcludedSetting({
  builtIn,
  paths,
}: {
  builtIn: string[];
  paths: string[];
}): JSX.Element {
  return (
    <FoldersSetting
      settingKey="excluded"
      label="Never look in"
      paths={paths}
      description={
        builtIn.length === 0
          ? undefined
          : `Always skipped: ${builtIn.join(", ")}.`
      }
    />
  );
}

/** The files marked "Not a bounce", each one to take back. */
function RejectedFilesSetting({
  files,
}: {
  files: SettingsValues["rejectedFiles"];
}): JSX.Element {
  const id = useId();
  const { run, error } = useCommand();
  const items = files.map((file) => ({
    key: file.fingerprint,
    title: file.name ?? file.fingerprint,
    detail: file.folder,
  }));

  return (
    <SettingRow id={id} label="Files marked Not a bounce" error={error}>
      <ForgetList
        labelledBy={`${id}-label`}
        items={items}
        empty="No file is marked."
        onForget={(item) =>
          void run(() => call("forget_rejection", { fingerprint: item.key }))
        }
      />
    </SettingRow>
  );
}

/** The folders marked "Never here", each one to take back. */
function NeverHereSetting({ folders }: { folders: string[] }): JSX.Element {
  const id = useId();
  const { run, error } = useCommand();
  const items = folders.map((folder) => ({ key: folder, title: folder }));

  return (
    <SettingRow id={id} label="Folders marked Never here" error={error}>
      <ForgetList
        labelledBy={`${id}-label`}
        items={items}
        empty="No folder is marked."
        onForget={(item) =>
          void run(() => call("forget_never_here", { folder: item.key }))
        }
      />
    </SettingRow>
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
          "Live's dit script isn't enabled. Enable it in Live › Settings › Link, Tempo & MIDI for live changes.",
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
}: {
  script: Snapshot["script"];
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
        <p className="text-micro text-pretty [overflow-wrap:anywhere] text-ink-soft">
          Installed at {script.path}
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

  return (
    <SettingRow
      id={id}
      label="Install the dit command"
      description="Links dit into /usr/local/bin so a terminal can run it. macOS asks for an administrator once."
      facts={installedAt === null ? undefined : `Installed at ${installedAt}`}
      control={
        installedAt === null && (
          <Button
            variant="outline"
            aria-label="Install the dit command"
            disabled={pending}
            onClick={() => void run(() => call("install_cli"))}
          >
            Install
          </Button>
        )
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
      control={
        !screenRecording && (
          <Button
            variant="outline"
            aria-label="Open System Settings"
            disabled={pending}
            onClick={() => void run(() => call("request_screen_recording"))}
          >
            Open System Settings
          </Button>
        )
      }
      error={error}
    />
  );
}
