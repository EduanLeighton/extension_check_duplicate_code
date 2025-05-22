# Duplicate Code Detector for VS Code

A powerful VS Code extension that helps you find and manage duplicate code in your projects. It supports multiple languages including JavaScript, TypeScript, and PHP, and can detect duplicate functions, if-statements, and code blocks.

## Features

- **Duplicate Function Detection**: Find similar functions across your codebase
- **If-Statement Analysis**: Detect duplicate conditional logic
- **Code Block Comparison**: Identify similar code blocks that could be refactored
- **Smart Comparison**: Advanced similarity algorithms to find non-identical but similar code
- **Interactive Review**: Review each duplicate with side-by-side comparison
- **One-Click Cleanup**: Remove duplicates or extract them to reusable functions

## Supported Languages

- JavaScript
- TypeScript
- PHP

## Requirements

- VS Code 1.60.0 or higher
- Node.js 14.x or higher
- TypeScript 4.0.0 or higher (for development)

## Usage

1. Open a file in VS Code
2. Use the command palette (Ctrl+Shift+P or Cmd+Shift+P) and select:
   - "Check for Duplicates" to scan the current file for duplicates
   - Choose the type of duplicates to find (Functions, If Statements, Code, or All)
3. Review each duplicate in the interactive panel
4. Choose to keep, remove, or refactor each duplicate

## Extension Settings

This extension contributes the following settings:

- `duplicateDetector.minSimilarity`: Minimum similarity threshold (0-1) for code comparison (default: 0.85)
- `duplicateDetector.ignoreComments`: Whether to ignore comments when comparing code (default: true)
- `duplicateDetector.maxFileSize`: Maximum file size to analyze in KB (default: 500)

## Known Issues

- Large files may take longer to process
- Some edge cases in nested code blocks might be missed
- PHP support is experimental and may not handle all syntax variations

## Release Notes

### 0.1.0

- Added support for PHP if-statement analysis
- Improved handling of nested code blocks
- Enhanced duplicate tracking across multiple passes
- Fixed issues with duplicate detection in large files

### 0.0.1

Initial release with basic duplicate detection for JavaScript and TypeScript

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

MIT
