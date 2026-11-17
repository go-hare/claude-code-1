import type { IDESelection } from '../../hooks/useIdeSelection.js'
import { createSignal } from '../../utils/signal.js'

export type ViewControllerSnapshot = {
  ideSelection: IDESelection | undefined
  bashesDialog: string | boolean
}

/**
 * Official `NJ` @209757946 — REPL ViewController owning IDE selection
 * consumption/restoration and transient overlay dialogs.
 */
export class ViewController {
  readonly #changed = createSignal()
  #snapshot: ViewControllerSnapshot = {
    ideSelection: undefined,
    bashesDialog: false,
  }
  #consumedBy: { selection: IDESelection; promptUuid: string } | null = null

  getSnapshot = (): ViewControllerSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) =>
    this.#changed.subscribe(listener)

  #publish(next: ViewControllerSnapshot): void {
    this.#snapshot = next
    this.#changed.emit()
  }

  setIdeSelection = (
    updater: React.SetStateAction<IDESelection | undefined>,
  ): void => {
    const next =
      typeof updater === 'function'
        ? updater(this.#snapshot.ideSelection)
        : updater
    if (Object.is(next, this.#snapshot.ideSelection)) return
    this.#publish({ ...this.#snapshot, ideSelection: next })
  }

  consumeIdeSelection = (uuid: string | undefined): void => {
    const current = this.#snapshot.ideSelection
    if (current && uuid) {
      this.#consumedBy = { selection: current, promptUuid: uuid }
    }
    if (current !== undefined) {
      this.#publish({ ...this.#snapshot, ideSelection: undefined })
    }
  }

  recordIdeSelectionConsumedBy = (
    uuid: string,
    selection: IDESelection | undefined,
  ): void => {
    if (selection) {
      this.#consumedBy = { selection, promptUuid: uuid }
    }
  }

  returnIdeSelection = (selection: IDESelection | undefined): void => {
    if (selection === undefined) return
    const current = this.#snapshot.ideSelection
    if (current?.text || current?.source === 'diff') return
    this.#publish({ ...this.#snapshot, ideSelection: selection })
  }

  restoreIdeSelectionConsumedBy = (
    uuid: string,
    selection: IDESelection | undefined,
  ): void => {
    if (selection !== undefined) {
      this.returnIdeSelection(selection)
    } else if (this.#consumedBy?.promptUuid === uuid) {
      this.returnIdeSelection(this.#consumedBy.selection)
    }
  }

  setBashesDialog = (updater: React.SetStateAction<string | boolean>): void => {
    const next =
      typeof updater === 'function'
        ? updater(this.#snapshot.bashesDialog)
        : updater
    if (Object.is(next, this.#snapshot.bashesDialog)) return
    this.#publish({ ...this.#snapshot, bashesDialog: next })
  }
}
