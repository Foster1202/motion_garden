export const sproutIcon = `<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 32V18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M20 23C5 24 5 10 5 10s16-1 15 13Z" fill="currentColor"/><path d="M20 17C20 4 35 5 35 5s0 14-15 12Z" fill="currentColor"/></svg>`;
export const carrotIcon = `<svg viewBox="0 0 80 80" aria-hidden="true"><path d="M32 26Q51 21 57 40L20 72Z" fill="#e89950"/><path d="m42 30 4-22m3 25L65 14m-15 16L72 29" fill="none" stroke="#618c50" stroke-width="8" stroke-linecap="round"/><path d="m29 44 10 3m-12 8 7 2" stroke="#c77b3e" stroke-width="3" stroke-linecap="round"/></svg>`;
export const appleIcon = `<svg viewBox="0 0 80 80" aria-hidden="true"><path d="M41 29C7 7 6 68 30 69q11-7 20 0C76 65 72 9 41 29" fill="#cfa18b"/><path d="M41 30q-6-16 4-22" stroke="#8e8062" stroke-width="5" fill="none"/><ellipse cx="54" cy="16" rx="13" ry="7" fill="#a8b28c" transform="rotate(-25 54 16)"/></svg>`;
export const homeIcon = `<svg viewBox="0 0 80 80" aria-hidden="true"><path d="M16 39 40 17 64 39v30H16Z" fill="#d8c29d"/><path d="M9 40 40 10 71 40" stroke="#aaa27e" stroke-width="7" stroke-linejoin="round" fill="none"/><path d="M33 69V48q8-10 16 0v21" fill="#9eaa8b"/></svg>`;

export class Overlay {
  readonly root = document.getElementById('game-ui')!;
  private modal?: HTMLDialogElement;
  private returnFocus?: HTMLElement;

  render(html: string) {
    this.closeModal();
    this.root.innerHTML = html;
  }
  on(action: string, callback: () => void) {
    this.root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.addEventListener('click', callback);
  }
  focus(action: string) {
    this.root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.focus({ preventScroll: true });
  }
  text(selector: string, value: string) {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (element && element.textContent !== value) element.textContent = value;
  }
  dialog(html: string, dismiss?: () => void) {
    this.returnFocus = document.activeElement as HTMLElement;
    this.modal = document.createElement('dialog');
    this.modal.className = 'rest-dialog';
    this.modal.setAttribute('aria-labelledby', 'dialog-title');
    this.modal.innerHTML = html;
    this.root.append(this.modal);
    this.modal.addEventListener('cancel', event => { event.preventDefault(); dismiss?.(); });
    this.modal.showModal();
  }
  closeModal() {
    this.modal?.close();
    this.modal?.remove();
    this.modal = undefined;
    this.returnFocus?.focus({ preventScroll: true });
    this.returnFocus = undefined;
  }
  destroy() { this.closeModal(); this.root.innerHTML = ''; }
}
