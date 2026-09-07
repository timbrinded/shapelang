import Foundation
import SwiftUI

struct AuditEvent {
    let message: String
}

protocol Repository {
    associatedtype Item
    func save(_ item: Item) async throws
    var count: Int { get }
}

actor AuditStore {
    private var events: [AuditEvent] = []

    init(events: [AuditEvent]) {
        self.events = events
    }

    func save(_ event: AuditEvent) async throws {
        events.append(event)
    }

    func load(id: Int) -> AuditEvent? {
        events.first
    }

    func load(id: String) -> AuditEvent? {
        events.first
    }

    subscript(index: Int) -> AuditEvent {
        events[index]
    }

    struct Snapshot {
        func count() -> Int { 0 }
    }
}

extension AuditStore {
    func clear() { events.removeAll() }
}

extension Repository where Item: Equatable {
    func contains(_ item: Item) -> Bool { false }
}

@MainActor
struct ContentView: View {
    @State private var count = 0

    var body: some View {
        VStack {
            Text("Count: \(count)")
            Button("Add") { count += 1 }
        }
    }
}

final class Connection {
    deinit {}
    var value: Int {
        get { 1 }
        set {}
    }
}
