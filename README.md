# [GeminiCommit VSCode Extension](https://github.com/VizzleTF/GeminiCommit)

GeminiCommit is a Visual Studio Code extension that automatically generates meaningful commit messages using Google's Gemini AI or a custom endpoint of your choice. This extension simplifies the process of writing clear and descriptive commit messages, saving time and improving the quality of your version control history.

<img src="example.gif" alt="GeminiCommit in action" width="600"/>

## Features

- Automatically generate commit messages based on your staged changes
- Uses Google's Gemini AI or a custom endpoint for intelligent and context-aware message generation
- Easy-to-use button in the Source Control view
- Secure storage of API keys using VS Code's built-in SecretStorage
- Supports both English and Russian languages for commit messages
- Choose between short, long, and custom commit message styles
- Select from different Gemini AI models or use a custom model with your endpoint

## Installation

### Installing from VS Code Marketplace

The easiest way to install GeminiCommit is directly from the Visual Studio Code Marketplace:

1. Open Visual Studio Code
2. Go to the Extensions view (Ctrl+Shift+X or Cmd+Shift+X on macOS)
3. Search for "GeminiCommit"
4. Click on the "Install" button for the GeminiCommit extension by VizzleTF

Alternatively, you can visit the marketplace page directly:
https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit

### Installing from VSIX

If you prefer to install from a VSIX file:

1. Download the `.vsix` file from the latest release.
2. Open Visual Studio Code.
3. Go to the Extensions view (Ctrl+Shift+X or Cmd+Shift+X on macOS).
4. Click on the "..." menu in the top-right corner of the Extensions view.
5. Select "Install from VSIX..." and choose the downloaded `.vsix` file.

### Building from Source

If you want to build the extension from source, follow these steps:

1. Clone the repository:
   ```
   git clone https://github.com/VizzleTF/GeminiCommit.git
   cd GeminiCommit
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Compile the extension:
   ```
   npm run compile
   ```

4. Package the extension:
   ```
   npm install -g @vscode/vsce
   vsce package
   ```

   This will create a `.vsix` file in your project directory.

5. Install the extension in VS Code:
   - Follow steps 2-5 from the "Installing from VSIX" section above, using the `.vsix` file you just created.

## Configuration

Before using the extension, you need to set up your API key and configure your preferences:

### For Gemini AI:

1. Get your Google AI API key from: https://aistudio.google.com/app/apikey
2. Open VS Code and run the command "GeminiCommit: Set API Key" from the command palette (Ctrl+Shift+P or Cmd+Shift+P on macOS).
3. Enter your Google AI API key when prompted. The key will be securely stored using VS Code's SecretStorage.

### For Custom Endpoint:

1. Enable the custom endpoint in settings:
   - Set `geminiCommit.useCustomEndpoint` to `true`
   - Set `geminiCommit.customEndpoint` to your endpoint URL
   - Set `geminiCommit.customModel` to the model name you want to use
2. Set your custom API key:
   - Use the command palette and search for "GeminiCommit: Set Custom API Key"
   - Enter your API key when prompted

### General Configuration:

1. Open VS Code settings (File > Preferences > Settings).
2. Search for "GeminiCommit" in the settings search bar.
3. Configure your preferences for language, message length, and AI model.

### Available Settings

- **Gemini Commit: Use Custom Endpoint**: Enable or disable the use of a custom endpoint for AI-generated commit messages.
- **Gemini Commit: Custom Endpoint**: The URL of your custom endpoint for generating commit messages.
- **Gemini Commit: Custom Model**: The model name to use with your custom endpoint.
- **Gemini Commit: Commit Language**: Choose between "english" and "russian" for the language of generated commit messages.
- **Gemini Commit: Commit Message Length**: Choose between "short", "long", and "custom" for the style of generated commit messages.
  - Short: Concise, single-line commit messages (up to 50 characters).
  - Long: More detailed commit messages with up to 3 lines, providing more context about the changes.
  - Custom: Use your own custom instructions for generating commit messages.
- **Gemini Commit: Gemini Model**: Select the Gemini AI model to use for generating commit messages (when not using a custom endpoint). Options include "gemini-1.0-pro", "gemini-1.5-pro", and "gemini-1.5-flash".
- **Gemini Commit: Custom Instructions**: If you selected "custom" for the commit message length, you can provide your own instructions here for generating commit messages.

## Usage

1. Stage your changes in Git as you normally would.
2. In the Source Control view, look for the "GeminiCommit" section.
3. Click on the "Generate Commit Message" button (with the rocket icon).
4. The extension will analyze your staged changes and generate a commit message using either Gemini AI or your custom endpoint, based on your configuration.
5. The generated message will be automatically inserted into the commit message input box.
6. Review and edit the message if needed, then commit as usual.

## Requirements

- Visual Studio Code version 1.93.0 or higher
- Git installed and configured in your workspace
- Active Google AI API key (for Gemini AI) or a custom endpoint with appropriate API key
- For building from source:
  - Node.js and npm installed on your system
  - Basic knowledge of TypeScript and VS Code extension development

## Known Issues

- The extension now provides more detailed error information for API-related issues, such as 403 errors due to API key problems or rate limiting.
- A retry mechanism has been implemented to handle temporary network issues, such as ECONNRESET errors.

Please report any issues or suggest improvements on our [GitHub Issues](https://github.com/VizzleTF/GeminiCommit/issues) page.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.

## Acknowledgments

- Thanks to Google for providing the Gemini AI API
- Inspired by the need for quick and meaningful commit messages in development workflows

## Support

If you encounter any problems or have any questions, please open an issue on the [GitHub repository](https://github.com/VizzleTF/GeminiCommit/issues).

---

## Краткая инструкция по установке (на русском)

1. Установите расширение GeminiCommit из [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit).
2. Для использования Gemini AI:
   - Получите API ключ Google AI на странице: https://aistudio.google.com/app/apikey
   - Откройте командную палитру VS Code (Ctrl+Shift+P или Cmd+Shift+P на macOS) и выполните команду "GeminiCommit: Set API Key".
   - Введите ваш API ключ Google AI, когда будет предложено. Ключ будет безопасно сохранен с использованием SecretStorage VS Code.
3. Для использования пользовательской конечной точки:
   - Включите использование пользовательской конечной точки в настройках:
     - Установите `geminiCommit.useCustomEndpoint` в значение `true`
     - Укажите URL вашей конечной точки в `geminiCommit.customEndpoint`
     - Укажите название модели в `geminiCommit.customModel`
   - Установите ваш пользовательский API ключ:
     - Используйте командную палитру и найдите "GeminiCommit: Set Custom API Key"
     - Введите ваш API ключ, когда будет предложено
4. Откройте настройки VS Code (Файл > Параметры > Настройки).
5. Найдите "GeminiCommit" в строке поиска настроек.
6. Настройте ваши предпочтения для языка, длины сообщений и модели AI.

---

Enjoy using GeminiCommit! We hope it enhances your development workflow and improves your commit message quality.