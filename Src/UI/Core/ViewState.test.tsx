import { act, fireEvent, render, screen } from "@testing-library/react";
import { ViewActivityContext } from "./ViewActivity";
import {
  useRetainedScroll,
  useRetainedViewState,
  ViewStateContext,
  ViewStateStore,
} from "./ViewState";

function View() {
  const [draft, setDraft] = useRetainedViewState("draft", "");
  const scroll = useRetainedScroll("scroll");
  return (
    <div {...scroll} data-testid="scroll">
      <input aria-label="draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    </div>
  );
}

it("restores lightweight state after eviction across 100 views and releases closed views", () => {
  const store = new ViewStateStore();
  for (let index = 0; index < 100; index++) {
    const id = `tab-${index}`;
    const view = render(
      <ViewStateContext.Provider value={{ store, id }}>
        <View />
      </ViewStateContext.Provider>,
    );
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: `draft-${index}` } });
    const scroller = screen.getByTestId("scroll");
    scroller.scrollTop = index + 10;
    fireEvent.scroll(scroller);
    view.unmount();
  }
  const restored = render(
    <ViewStateContext.Provider value={{ store, id: "tab-0" }}>
      <View />
    </ViewStateContext.Provider>,
  );
  expect(screen.getByLabelText("draft")).toHaveValue("draft-0");
  expect(screen.getByTestId("scroll").scrollTop).toBe(10);
  restored.unmount();
  store.retain(["tab-99"]);
  expect(store.read("tab-0", "draft")).toBeUndefined();
  expect(store.read("tab-99", "draft")).toBe("draft-99");
});

it("does not replace a retained scroll position when an inactive surface resets", () => {
  const store = new ViewStateStore();
  store.write("tab", "scroll", { top: 200, left: 0 });
  const view = render(
    <ViewStateContext.Provider value={{ store, id: "tab" }}>
      <ViewActivityContext.Provider value={false}>
        <View />
      </ViewActivityContext.Provider>
    </ViewStateContext.Provider>,
  );
  act(() => fireEvent.scroll(screen.getByTestId("scroll")));
  expect(store.read("tab", "scroll")).toEqual({ top: 200, left: 0 });
  view.unmount();
});

it("reference counts unfinished view leases and releases idempotently", () => {
  const store = new ViewStateStore();
  const updates = vi.fn();
  const unsubscribe = store.subscribe(updates);
  const first = store.hold("settings");
  const second = store.hold("settings");
  first();
  first();
  expect(store.protectedIds()).toEqual(["settings"]);
  second();
  expect(store.protectedIds()).toEqual([]);
  expect(updates).toHaveBeenCalledTimes(4);
  unsubscribe();
});

it("reserves an active view slot before admitting another protected transaction", () => {
  const store = new ViewStateStore(12);
  const release = Array.from({ length: 11 }, (_, index) => store.hold(`transaction-${index}`));
  expect(() => store.hold("overflow")).toThrow("resource.limit");
  expect(store.protectedIds()).toHaveLength(11);
  const existing = store.hold("transaction-0");
  existing();
  release[0]();
  const admitted = store.hold("next");
  expect(store.protectedIds()).toHaveLength(11);
  admitted();
  for (const end of release) end();
  expect(store.protectedIds()).toEqual([]);
});
