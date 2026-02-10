import type { AppState, AppStateKey } from "./app-state.js";

type StoreListener = (state: Readonly<AppState>, changedSlices: ReadonlySet<AppStateKey>) => void;

function hasPatchChanges<TSlice extends object>(currentSlice: TSlice, patch: Partial<TSlice>): boolean {
  for (const key of Object.keys(patch) as Array<keyof TSlice>) {
    if (!Object.is(currentSlice[key], patch[key])) {
      return true;
    }
  }

  return false;
}

export class AppStore {
  private state: AppState;
  private readonly listeners = new Set<StoreListener>();

  constructor(initialState: AppState) {
    this.state = initialState;
  }

  getState(): Readonly<AppState> {
    return this.state;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setState(nextPartialState: Partial<AppState>): void {
    const updates: Partial<AppState> = {};
    const changedSlices = new Set<AppStateKey>();

    for (const key of Object.keys(nextPartialState) as AppStateKey[]) {
      const nextSlice = nextPartialState[key];
      if (nextSlice === undefined || Object.is(nextSlice, this.state[key])) {
        continue;
      }

      (updates as Record<AppStateKey, AppState[AppStateKey] | undefined>)[key] = nextSlice as AppState[AppStateKey];
      changedSlices.add(key);
    }

    if (changedSlices.size === 0) {
      return;
    }

    this.state = {
      ...this.state,
      ...updates
    };
    this.emit(changedSlices);
  }

  updateSlice<TKey extends AppStateKey>(key: TKey, updater: (currentSlice: AppState[TKey]) => AppState[TKey]): void {
    const currentSlice = this.state[key];
    const nextSlice = updater(currentSlice);

    if (Object.is(currentSlice, nextSlice)) {
      return;
    }

    this.state = {
      ...this.state,
      [key]: nextSlice
    };

    this.emit(new Set([key]));
  }

  patchSlice<TKey extends AppStateKey>(key: TKey, patch: Partial<AppState[TKey]>): void {
    if (Object.keys(patch).length === 0) {
      return;
    }

    const currentSlice = this.state[key];
    const currentSliceRecord = currentSlice as AppState[TKey] & object;
    const patchRecord = patch as Partial<AppState[TKey]> & object;

    if (!hasPatchChanges(currentSliceRecord, patchRecord)) {
      return;
    }

    const nextSlice = {
      ...(currentSlice as object),
      ...(patch as object)
    } as AppState[TKey];

    this.state = {
      ...this.state,
      [key]: nextSlice
    };

    this.emit(new Set([key]));
  }

  private emit(changedSlices: ReadonlySet<AppStateKey>): void {
    for (const listener of this.listeners) {
      listener(this.state, changedSlices);
    }
  }
}
