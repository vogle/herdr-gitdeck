/**
 * Wakes one waiting task. A fire with nobody waiting is remembered (once), so a
 * change seen while the task was busy still wakes it afterwards.
 */
export class Signal {
  #pending = false;
  #waiter: (() => void) | null = null;

  fire(): void {
    const waiter = this.#waiter;
    if (waiter) {
      this.#waiter = null;
      waiter();
    } else {
      this.#pending = true;
    }
  }

  wait(): Promise<void> {
    if (this.#pending) {
      this.#pending = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#waiter = resolve;
    });
  }
}
