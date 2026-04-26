export interface ReplayKeyboardEvent {
  key: string;
  modifiers: string[];
}

export function keyPressName(event: ReplayKeyboardEvent): string {
  return [...event.modifiers, event.key].join("+");
}
