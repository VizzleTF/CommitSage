# Commit Message Formats

CommitSage supports 8 commit message formats. Choose the one that matches your team's conventions.

---

## Conventional

The most widely adopted format. Supports optional scope and multi-line body.

```
type(scope): description

- bullet point 1
- bullet point 2
```

**Example:**

```
feat(auth): add OAuth2 login flow

- Add Google and GitHub providers
- Store tokens in secure storage
```

---

## Angular

Based on the Angular project's commit conventions. Very similar to Conventional but follows Angular-specific rules.

```
type(scope): short summary
```

**Example:**

```
fix(router): resolve navigation guard race condition

- Add mutex lock for concurrent navigations
- Clear pending state on route cancel
```

---

## Karma

Single-line format used by the Karma test runner project. No body or footer.

```
type(scope): message
```

**Example:**

```
chore(ci): update deployment script to Node 16
```

---

## Semantic

Minimal format without scope. Just type and message.

```
type: message
```

**Example:**

```
feat: add user avatar upload functionality
```

---

## Emoji

Uses Gitmoji-style emoji prefixes instead of text types.

```
:emoji: message
```

**Common emojis:**

| Emoji | Code | Meaning |
|-------|------|---------|
| ✨ | `:sparkles:` | New feature |
| 🐛 | `:bug:` | Bug fix |
| 📝 | `:memo:` | Documentation |
| 🎨 | `:art:` | Code style/formatting |
| ♻️ | `:recycle:` | Refactoring |
| ⚡️ | `:zap:` | Performance |
| 🧪 | `:test_tube:` | Tests |
| 🛠️ | `:hammer_and_wrench:` | Build/dependencies |
| 🔒 | `:lock:` | Security fix |

**Example:**

```
✨ add real-time collaboration feature
```

---

## EmojiKarma

Combines Emoji and Karma formats — emoji prefix followed by type, scope, and message.

```
:emoji: type(scope): message
```

**Example:**

```
✨ feat(editor): add real-time collaboration
```

---

## Google

Follows Google's commit message style with optional body and footer sections.

```
Type: Description

Body

Footer
```

**Example:**

```
feat: Add user authentication system

Implemented OAuth2 integration with Google and GitHub providers.
```

---

## Atom

Based on the Atom editor's conventions. Includes scope, body, and footer.

```
type(scope): subject

body

footer
```

**Example:**

```
feat(auth): add OAuth2 integration with Google provider

Implemented complete OAuth2 flow including:
- Authorization code exchange
- Token refresh mechanism
- User profile retrieval
```

---

## Commit Types Reference

All formats (except Emoji) use the same set of types:

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Formatting, no code change |
| `refactor` | Code change without fixing bugs or adding features |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `build` | Build system or dependencies |
| `ci` | CI/CD changes |
| `chore` | Other maintenance tasks |
| `revert` | Revert a previous commit (Google, Atom only) |

## Choosing a Format

- **Conventional** — best default choice, widely supported by tooling (changelogs, versioning)
- **Angular** — if your project follows Angular conventions
- **Karma** — when you want simple, single-line messages
- **Semantic** — when scope is unnecessary and you want minimal format
- **Emoji** — for visual commit logs, popular in open-source projects
- **EmojiKarma** — when you want both emoji visual cues and structured types
- **Google/Atom** — when your project follows these specific conventions
