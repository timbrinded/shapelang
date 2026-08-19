export interface SystemEvent {
  id: string;
}

export function loadEvents(events: readonly SystemEvent[]): readonly SystemEvent[] {
  return events;
}

export function renderEvents(events: readonly SystemEvent[]): string {
  return events.map((event) => event.id).join("\n");
}
