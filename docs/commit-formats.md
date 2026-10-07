# Commit message formats

Commit Sage writes commit messages in one of 11 formats, set by `commitSage.commit.commitFormat` (default `conventional`). Each format sends the model a prompt template. The skeletons, limits and examples below come from the English templates.

| Value | Skeleton |
|---|---|
| `conventional` | `type(scope): description` + optional bullet body |
| `angular` | `type(scope): short summary` + optional bullet body |
| `karma` | `type(scope): message` |
| `semantic` | `type: message` |
| `emoji` | `:emoji: message` |
| `emojiKarma` | `:emoji: type(scope): message` |
| `google` | `Type: Description`, body, footer |
| `atom` | `type(scope): subject`, body, footer |
| `detailed` | `Summary:`, `Details:`, `Effects:` sections |
| `previous` | The style of the repository's recent commits |
| `custom` | The text of `commitSage.commit.customInstructions` |

## Conventional

```
<type>[optional scope]: <description>

[optional body with bullet points]
```

- First line: at most 50 characters.
- Small changes get the first line only.
- Body: up to 5 lines, each starts with `- ` and has at most 50 characters.
- Documentation-only changes get the `docs` type.

```
feat(auth): add user authentication

- Implemented OAuth2 provider integration
- Created auth service module
- Added session management
```

## Angular

```
<type>(<scope>): <short summary>

[optional body with bullet points]
```

- First line: at most 50 characters.
- Small changes get the first line only.
- Body lines start with `- ` and have at most 50 characters.

```
refactor(core): optimize database queries

- Implement query caching
- Add connection pooling
- Update error handling
```

## Karma

```
<type>(<scope>): <message>
```

```
chore(ci): update deployment script to Node 16
```

## Semantic

```
type: message
```

```
feat: add user avatar upload functionality
```

## Emoji

```
:emoji: commit message
```

The template gives the model this list:

| Emoji | Code | Meaning |
|---|---|---|
| ✨ | `:sparkles:` | New feature |
| 🐛 | `:bug:` | Bug fix |
| 📝 | `:memo:` | Documentation updates |
| 🎨 | `:art:` | Code style/formatting changes |
| ♻️ | `:recycle:` | Refactoring without functionality changes |
| 🧪 | `:test_tube:` | Adding or changing tests |
| 🛠️ | `:hammer_and_wrench:` | Build/tools/dependencies |
| 🤖 | `:robot:` | CI/CD configuration |
| ⚡️ | `:zap:` | Performance optimization |
| 🔧 | `:wrench:` | Maintenance/chores |
| 🔒 | `:lock:` | Security fixes |
| 🚀 | `:rocket:` | Release/deployment |
| 🔥 | `:fire:` | Remove code or files |
| ⬆️ | `:arrow_up:` | Upgrade dependencies |
| ⬇️ | `:arrow_down:` | Downgrade dependencies |
| ✅ | `:white_check_mark:` | Fix CI build |

```
✨ add real-time collaboration feature
```

## EmojiKarma

```
:emoji: type(scope): message
```

The emoji comes from the [Emoji](#emoji) list; the type comes from the [types table](#types-per-format).

```
✨ feat(auth): add user authentication system
```

## Google

```
<Type>: <Description>

<Body>

<Footer>
```

```
feat: Add user authentication system

Implemented OAuth2 integration with Google and GitHub providers.
Added JWT token management and refresh mechanism.

Closes #123
```

## Atom

```
<type>(<scope>): <subject>

<body>

<footer>
```

The scope is optional and names the affected part of the code, such as `auth`, `ui`, `api` or `core`.

```
feat(auth): add OAuth2 integration with Google provider

Implemented complete OAuth2 flow including:
- Authorization code exchange
- Token refresh mechanism

Closes #123
```

## Detailed

```
Summary: <one-line imperative summary>

Details:
- <changed file/module>: <what changed>

Effects:
- <impact on behaviour, performance, or compatibility>
```

- `Summary:` text: at most 72 characters after `Summary: `.
- `Details:`: up to 6 bullets, each at most 80 characters. Left out when the change is one trivial edit.
- `Effects:`: up to 4 bullets, each at most 80 characters. Left out when the change has no runtime impact.

The built-in validator requires both `Details:` and `Effects:` sections, so a message without them fails validation.

```
Summary: Refactor user authentication to token-based flow

Details:
- src/auth.js: replace session storage with JWT issuance and verification
- src/userModel.js: remove deprecated password-hash helpers

Effects:
- Session storage no longer required server-side
```

## Previous

The model gets the repository's recent commit messages and copies their style: type prefixes, scope, capitalization and body. `commitSage.commit.recentCommitsCount` (default `5`) sets how many messages it gets, and `commitSage.commit.recentCommitsScope` (`all` or `mine`) sets whose. When the repository has no usable commits, Commit Sage uses the Conventional template. Commitlint validation does not apply to this format.

## Custom

The text of `commitSage.commit.customInstructions` replaces the template. Selecting `custom` in the Commit Sage sidebar also turns on `commitSage.commit.useCustomInstructions`. With `useCustomInstructions` off, or with empty instructions, Commit Sage uses the Conventional template. Commitlint validation does not apply to this format.

`useCustomInstructions` with non-empty instructions replaces the template for every other format as well. The prompt then gets no language instruction and no recent-commit examples.

## Types per format

The table lists the types each prompt template names. `emoji`, `detailed`, `previous` and `custom` have no types.

| Type | conventional | angular | karma | semantic | emojiKarma | google | atom |
|---|---|---|---|---|---|---|---|
| `feat` | yes | yes | yes | yes | yes | yes | yes |
| `fix` | yes | yes | yes | yes | yes | yes | yes |
| `docs` | yes | yes | yes | yes | yes | yes | yes |
| `style` | yes | | yes | yes | yes | yes | yes |
| `refactor` | yes | yes | yes | yes | yes | yes | yes |
| `test` | yes | yes | yes | yes | yes | yes | yes |
| `chore` | yes | | yes | yes | yes | yes | yes |
| `perf` | yes | yes | | | | yes | yes |
| `build` | yes | yes | | | | yes | yes |
| `ci` | yes | yes | | | | yes | yes |
| `revert` | | | | | | yes | yes |

With `commitSage.commit.commitlint.enabled` and the `builtin` engine, the validator accepts a different set for some formats:

| Format | Types the validator accepts | Header limit |
|---|---|---|
| `conventional` | the 11 types above | 72 |
| `angular` | the 11 types above except `chore`; no `!` breaking marker | 72 |
| `karma`, `semantic`, `atom`, `emojiKarma` | `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`; `semantic` allows no scope | 72; `emojiKarma` 80 |
| `google` | `Feat`, `Fix`, `Docs`, `Style`, `Refactor`, `Test`, `Chore` | 72 |
| `emoji` | any message after an emoji | 72 |
| `detailed` | no types; requires the `Summary:`, `Details:` and `Effects:` sections | 72 after `Summary: ` |

For `conventional` and `angular`, the `builtin` engine also reads the repository's commitlint config. Validator settings are described in [configuration.md](configuration.md).
