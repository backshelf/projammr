import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { MotionGlobalConfig } from "motion/react";

// happy-dom's fetch refuses file:// URLs, which is how a suite loads a local
// wasm module; the runtime's own fetch family stays in place.
const runtimeFetch = {
  fetch: globalThis.fetch,
  Request: globalThis.Request,
  Response: globalThis.Response,
  Headers: globalThis.Headers,
};

/**
 * Preloaded before every test file by a consumer's `bunfig.toml`: a happy-dom
 * window on the globals, so Testing Library can render the components that
 * need a DOM.
 */
GlobalRegistrator.register();
Object.assign(globalThis, runtimeFetch);

/**
 * happy-dom's `Element.animate` is a timer stub, so a Motion animation would
 * never resolve deterministically and a Base UI overlay's `getAnimations()`
 * wait would hang. `skipAnimations` completes every Motion animation
 * instantly; `BASE_UI_ANIMATIONS_DISABLED` (read by Base UI's
 * `useAnimationsFinished`) does the same for its own exit detection.
 */
MotionGlobalConfig.skipAnimations = true;
(
  globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }
).BASE_UI_ANIMATIONS_DISABLED = true;

/**
 * The registrator leaves `EventTarget` pointing at the runtime's own class,
 * not the one happy-dom's nodes extend, so `element instanceof EventTarget` —
 * how Motion decides whether it has been handed an element or a selector — is
 * false for every element in the document. Point it at the class the nodes
 * actually come from.
 */
globalThis.EventTarget = Object.getPrototypeOf(
  globalThis.Node
) as typeof EventTarget;

/**
 * How a node prints in a failed assertion: its opening tag. Left alone, the
 * runtime walks the node's every property, which reaches the whole document
 * and React's fibers; one `expect(element).toBeNull()` that fails while a
 * `waitFor` is still polling then spends seconds building a message hundreds
 * of megabytes long, and that was most of the time the slowest suites took.
 */
Object.defineProperty(
  globalThis.Node.prototype,
  Symbol.for("nodejs.util.inspect.custom"),
  {
    configurable: true,
    value(this: Node) {
      if (!(this instanceof globalThis.Element)) return this.nodeName;
      const attributes = Array.from(
        this.attributes,
        ({ name, value }) => ` ${name}="${value}"`
      ).join("");
      return `<${this.localName}${attributes}>`;
    },
  }
);

/**
 * happy-dom has no `IntersectionObserver`, so anything that waits for the
 * reader to reach it would never hear anything. This one reports every
 * observed element as reached, on a microtask rather than inside `observe` —
 * the real API never calls back synchronously, and a test that asserts the
 * waiting state needs the same gap.
 */
class ReachedObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: readonly number[] = [];

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    queueMicrotask(() => {
      this.callback(
        [{ target, isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver
      );
    });
  }

  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

globalThis.IntersectionObserver =
  ReachedObserver as unknown as typeof IntersectionObserver;
