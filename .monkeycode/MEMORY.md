# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy

- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[Project Knowledge Summary]
- Date: 2026-07-29
- Context: Discovered by Agent while verifying resource deletion locking
- Category: Environment Configuration
- Instructions:
  - The workspace currently has no installed Node.js dependencies; `npm test`, `npm run typecheck`, and `npm run lint` cannot resolve their project executables.

[Project Knowledge Summary]
- Date: 2026-08-01
- Context: Agent implemented Matrix chat UI restructure with virtualized message list
- Category: Build Methods
- Instructions:
  - New components created: structures/MessageList.tsx, structures/ScrollPanel.tsx, views/MessageBubble.tsx, views/EventTile/index.tsx, grouper/MainGrouper.ts, ChatRoom.tsx, ChatPanel.tsx, ChatSection.tsx, ChatStore.tsx, components/MessageInput.tsx
  - Added `react-virtuoso` to package.json dependencies for virtualized scrolling
  - Extended DisplayMessage interface with threadId, replyCount, isEdited fields
  - All new code passes TypeScript and ESLint checks
