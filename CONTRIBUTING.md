# Contributing to Commit Sage

We're thrilled that you're interested in contributing to Commit Sage! This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork:
```bash
git clone https://github.com/your-username/CommitSage.git
```
3. Install dependencies:
```bash
npm install
```
4. Create a branch for your changes:
```bash
git checkout -b feature/your-feature-name
```

## Development

1. Make your changes
2. Build the extension:
```bash
npm run compile
```
3. Run the linter:
```bash
npm run lint
```

## Submitting Changes

1. Push your changes to your fork
2. Submit a pull request to the main Commit Sage repository.

## Pull Request Guidelines

- Follow the existing code style
- Include tests for new features
- Update documentation as needed
- Keep changes focused and atomic
- Describe your changes in detail

## Code Style

- Use TypeScript
- Follow ESLint rules
- Write clear commit messages
- Add JSDoc comments for public APIs

## Contributor Guides

Detailed guides for common contribution tasks are available in the `docs/` directory:

- [Adding a new language](docs/adding-languages.md)
- [Adding a new commit format](docs/adding-formats.md)
- [Adding a new AI provider](docs/adding-providers.md)

## Testing

- Test your changes in VS Code by pressing F5 to launch the Extension Development Host
- Verify the extension compiles without errors (`npm run compile`)

## Documentation

- Update README.md for user-facing changes
- Add JSDoc comments for new functions
- Keep documentation clear and concise

## Need Help?

- Join our [Telegram Group](https://t.me/gemini_commit)
- Ask questions in GitHub Issues

Thank you for contributing to Commit Sage!