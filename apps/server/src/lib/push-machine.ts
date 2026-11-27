import {
  optionalPushingMachine,
  pushingMachine,
} from "../db/queries/machines.js";

/** The header every dit request names its machine in. */
const MACHINE_HEADER = "x-machine-id";

/** The machine a push came from, as the hub knows it. */
export type PushMachine = { id: string; name: string };

/**
 * The machine a push's `X-Machine-Id` header names, when it is a live machine
 * of the caller's; anything else is the error {@link pushingMachine} raises.
 */
export function pushMachine(
  headers: Headers,
  userId: string
): Promise<PushMachine> {
  return pushingMachine(headers.get(MACHINE_HEADER) ?? undefined, userId);
}

/**
 * The machine named by `X-Machine-Id` when present and registered to `userId`,
 * or `null` when omitted or unregistered.
 */
export function optionalPushMachine(
  headers: Headers,
  userId: string
): Promise<PushMachine | null> {
  return optionalPushingMachine(
    headers.get(MACHINE_HEADER) ?? undefined,
    userId
  );
}

/**
 * The machine a pushed row belongs to: the pusher's own when the row names
 * that machine's name, null for a row naming another machine, since a push
 * carries rows made elsewhere too.
 */
export function attributedTo(
  machine: PushMachine,
  machineName: string | null
): string | null {
  return machineName === machine.name ? machine.id : null;
}
