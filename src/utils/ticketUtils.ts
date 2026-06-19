// Matches common issue tracker ticket IDs: PROJECT-123, ABC-456, etc.
// Works with Jira, Linear, GitHub Projects labels, and similar conventions.
const TICKET_PATTERN = /\b([A-Z][A-Z0-9]*-[0-9]+)\b/;

export function extractTicketId(branchName: string): string | null {
    const match = TICKET_PATTERN.exec(branchName);
    return match ? match[1] : null;
}

/**
 * Injects `ticket` into the first line of `message`.
 *
 * - `scope`: inserts as conventional-commit scope → `type(TICKET): desc`.
 *   Also handles emoji-prefixed headers → `:emoji: type(TICKET): desc`.
 *   If a scope already exists it is replaced with the ticket ID.
 * - `prefix`: inserts right after the first `: ` → `type: TICKET desc`.
 *   Works for semantic, atom, detailed, and similar formats.
 *
 * Returns the message unchanged when the ticket is already present or the
 * header does not match the expected pattern.
 */
export function injectTicketIntoMessage(
    message: string,
    ticket: string,
    placement: 'scope' | 'prefix',
): string {
    const lines = message.split('\n');
    const header = lines[0];

    if (placement === 'scope') {
        // Standard conventional header: type(scope)!?: description
        const std = /^(\w+)(\(([^)]*)\))?(!)?(:\s*)(.*)$/.exec(header);
        if (std) {
            const [, type, , existingScope, bang, colon, desc] = std;
            if (existingScope === ticket) {
                return message;
            }
            lines[0] = `${type}(${ticket})${bang ?? ''}${colon}${desc}`;
            return lines.join('\n');
        }

        // Emoji-prefixed header: :emoji: type(scope)!?: description
        const emoji = /^(:[a-z_]+:\s*)(\w+)(\(([^)]*)\))?(!)?(:\s*)(.*)$/.exec(header);
        if (emoji) {
            const [, emojiToken, type, , existingScope, bang, colon, desc] = emoji;
            if (existingScope === ticket) {
                return message;
            }
            lines[0] = `${emojiToken}${type}(${ticket})${bang ?? ''}${colon}${desc}`;
            return lines.join('\n');
        }

        return message;
    }

    // prefix placement — insert ticket right after the first ': '
    if (header.includes(ticket)) {
        return message;
    }
    const colonIdx = header.indexOf(': ');
    if (colonIdx === -1) {
        return message;
    }
    lines[0] = `${header.slice(0, colonIdx + 2)}${ticket} ${header.slice(colonIdx + 2)}`;
    return lines.join('\n');
}
