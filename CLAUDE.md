# CLAUDE.md Guide for Berabundle

## Commands
- Start application: `npm start`

## Code Style
- CommonJS modules with `require`/`module.exports`
- Classes: PascalCase (BundleCreator, SafeAdapter)
- Methods/variables: camelCase
- Constants: UPPER_CASE
- Private methods: prefix with underscore (_methodName)
- JSDoc comments required for classes and methods
- Error handling via centralized ErrorHandler class

## Project Structure
- Clear separation with adapters, bundlers, executors
- Storage uses repository pattern
- Execution uses adapter pattern
- UI flows for user interaction

## Working Guidelines
- Understand the codebase before acting
- Use official documentation - add to md files in /docs
- Avoid fallbacks unless explicitly requested
- Don't use dummy data unless asked
- Ask for guidance when facing uncertainty
- Document working solutions as you discover them
- Prefer simple, robust implementations

## Best Practices
- Use existing patterns when adding features
- Create bundles through BundleCreator class
- Handle errors through ErrorHandler
- Access files via storage repositories
- Track progress with ProgressTracker
- Update CLAUDE.md when adding new commands