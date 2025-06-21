# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.2.25] - 2025-06-21

### Added
- ✨ **PROJECT CONFIGURATION**: Added support for `.commitsage` file in project root
  - Override extension settings per project (AI provider, commit format, language, etc.)
  - Command to create project configuration file with template
  - Automatic file watching and cache invalidation on changes
  - Settings priority: project file > workspace settings > global settings
- ✨ Added project configuration validation with error notifications
- 📚 Updated documentation with project configuration examples and usage

### Changed
- ♻️ Refactored `ConfigService` to support hierarchical configuration loading
- 🔧 Enhanced settings validation for project-specific configurations

## [2.2.24] - 2025-06-21

### Fixed
- 🐛 Fixed release workflow notification message generation
- 🐛 Resolved Telegram message parsing errors in CI pipeline

### Changed
- ♻️ Refactored AI service architecture for better modularity
- 🔧 Improved release notification system

## [2.2.22] - 2025-06-21

### Changed
- 🔧 Improved AI prompt for cleaner changelog output
- 🔧 Fixed Telegram message parsing errors in CI
- 📦 Added Open VSX Registry publishing workflow
- Updated ESLint configuration to new format
- Major dependency updates: TypeScript ESLint, Node types, Axios

### Infrastructure
- Enhanced release workflow with better error handling
- Added AI-powered changelog summarization
- Improved Telegram notifications for releases

## [2.2.13] - 2025-05-01

### Added
- ✨ Added Spanish language support for commit messages
- ✨ Added emoji-karma commit format (`🎨 feat(scope): message`)
- 🔧 Added support for DeepSeek R1 model with think tag removal
- 📈 Added telemetry for failed message generation
- 🧪 Added ESLint to PR checks with import and unused imports plugins

### Fixed
- 🐛 Fixed submodule handling in diff generation
- 🐛 Improved API error handling across services
- 💄 Fixed typo in `emojiKarma` configuration option

### Changed
- ♻️ Refactored AI service to move provider-specific logic to separate classes
- ♻️ Centralized think tag removal logic
- 🎨 Updated extension icon for better theme compatibility

## [2.2.0] - 2025-01-30

### Added
- ✨ **NEW AI PROVIDERS**: Added support for Codestral AI
- ✨ Added new AI service classes with improved architecture
- ✨ Added source control context menu integration
- ✨ Improved Git blame handling and analysis
- ✨ Enhanced diff generation for new files
- ✨ Added custom endpoint validation and normalization

### Fixed
- 🐛 Fixed custom commit instructions support
- 🐛 Updated marketplace links in release workflow

### Changed
- ♻️ Improved Git blame and diff logic
- ♻️ Removed unnecessary comments and unused code
- 🎨 Updated extension icon design
- 📝 Updated settings documentation and grouping

## [2.0.0] - 2025-01-21

### Added
- 🎉 **MAJOR REBRAND**: Extension renamed to "Commit Sage"
- ✨ Added multiple language support:
  - 🇯🇵 Japanese language support
  - 🇨🇳 Chinese language support
  - 🇪🇸 Spanish language support
- ✨ Added keyboard shortcut (Ctrl/Cmd+G) for commit generation
- ✨ Added auto-commit and auto-push features
- ✨ Enhanced error handling and retry logic
- ✨ Added detailed logging and telemetry
- ✨ Added commit input dialog functionality

### Fixed
- 🐛 Fixed Chinese character support in commit messages
- 🐛 Fixed API key handling in CI workflow
- 🐛 Improved error messages and user feedback

### Changed
- ♻️ Refactored extension activation and Git service
- ♻️ Improved error handling and telemetry system
- ♻️ Removed unused commands and views
- 🔧 Updated Node.js version and build process

### Removed
- 🗑️ Removed deprecated commands and view components

## [1.9.0] - 2025-01-20

### Added
- ✨ Added Chinese language support (community contribution)
- ✨ Enhanced error handling and logging
- ✨ Added auto-commit and push options
- ✨ Improved file handling for untracked files

### Changed
- 🔧 Updated VS Code minimum version requirement
- 📦 Added .vscodeignore for better package optimization
- 🔧 Improved build process and dependencies

## [1.8.0] - 2024-12-28

### Added
- ✨ **COMMIT FORMATS**: Added multiple commit message formats:
  - Conventional Commits
  - Angular style
  - Karma style  
  - Semantic commits
  - Emoji commits
- ✨ Added API key validation and secure handling
- ✨ Added configuration for commit message length
- 📚 Enhanced documentation with examples

### Changed
- 🔧 Improved settings organization and descriptions
- 📝 Updated README with detailed setup instructions

## [1.7.0] - 2024-12-24

### Added
- ✨ Added Gemini 2.0 Flash experimental model support
- ✨ Added support for staged/unstaged changes handling
- ✨ Enhanced Git blame analysis integration
- 🔧 Added custom API endpoint configuration
- 📱 Added community links and Telegram notifications

### Changed
- 🏗️ Improved module structure and organization
- 🔧 Enhanced release workflow automation
- 📊 Added telemetry and usage analytics

## [1.6.0] - 2024-11-28

### Added
- ✨ **GIT INTEGRATION**: Enhanced Git operations
  - Support for staged changes detection
  - Improved handling of untracked files
  - Better diff generation for new files
- ✨ Added repository selection for multi-repo workspaces
- ✨ Added progress indicators for better UX

### Changed
- 🏗️ Simplified and modularized Git service
- 📝 Improved README with badges and better documentation

## [1.5.0] - 2024-09-30

### Added
- ✨ **AI INTEGRATION**: Git blame analysis for better context
- ✨ Added custom instructions support
- ✨ Enhanced error handling and user feedback

### Changed
- 🏗️ Extracted logger and configuration services
- 📝 Simplified README and setup instructions

## [1.0.0] - 2024-08-26

### Added
- 🎉 **INITIAL STABLE RELEASE**
- ✨ Google Gemini AI integration for commit message generation
- ✨ Multiple AI models support (Gemini Pro, Flash)
- ✨ Git integration with diff analysis
- ✨ VS Code native integration
- ✨ Configurable commit message styles
- 🔧 Comprehensive settings and configuration
- 📚 Full documentation and examples

### Security
- 🔒 Secure API key storage and validation
- 🔒 Privacy-focused telemetry (optional)

---

## Migration Notes

### From 1.x to 2.x
- Extension renamed from "GeminiCommit" to "Commit Sage"
- Enhanced multi-language support
- New AI providers available (Codestral, OpenAI, Ollama)
- Improved error handling and user experience

### Configuration Changes
- Settings reorganized with better grouping
- New language and format options
- Enhanced provider selection

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to contribute to this project.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. 