# AI Uinify

Chrome Extension that unifies multiple AI subscriptions into a single interface with mention-based routing.

## Features

- **Mention-based dispatch**: Use `@gpt`, `@gem`, or `@perp` to route prompts to ChatGPT, Gemini, or Perplexity
- **Unified interface**: Single popup to compose and send prompts to multiple AI providers
- **Activity tracking**: Real-time feed of dispatch status and responses
- **Context management**: Scoped context memory for maintaining conversation state
- **Persistent storage**: In-flight task recovery after crashes or reloads

## Architecture

### Orchestrator Components

- **MentionParser** - Parses composed prompts and splits them by provider mentions
- **DispatchCoordinator** - Coordinates parsing, dispatch, retries/timeouts, persistence, and activity events
- **ProviderAdapter** - Adapter interface for provider-specific transports
- **LocalDispatchStore** - Persists dispatch state to localStorage
- **UnifiedActivityFeed** - Aggregates and streams activity events

### Context Layer

- **ContextMemory** - Scoped context storage system
- **ContextStore** - Persistence layer for context data
- **Dashboard Controls** - UI for managing context scopes

## Installation

### For Development

1. Clone the repository:
   ```bash
   git clone https://github.com/timothybaloyi-personal/ai-uinify.git
   cd ai-uinify
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build TypeScript:
   ```bash
   npm run build
   ```

4. Load in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked"
   - Select the `ai-uinify` directory

### For Production

_Coming soon: Chrome Web Store listing_

## Usage

1. Click the AI Uinify extension icon in your Chrome toolbar
2. Compose a prompt with mention aliases:
   ```
   @gpt Explain quantum computing in simple terms
   @gem Write a haiku about AI
   @perp What are the latest developments in AI?
   ```
3. Click "Dispatch Prompt"
4. Monitor the activity feed for real-time status updates

## Supported Providers

| Provider | Aliases | URL |
|----------|---------|-----|
| ChatGPT | `@gpt`, `@chatgpt` | https://chat.openai.com |
| Gemini | `@gem`, `@gemini` | https://gemini.google.com |
| Perplexity | `@perp`, `@perplexity` | https://www.perplexity.ai |

## Configuration

Provider settings are configured in `config/providers.ts`:

- Timeout policies
- Retry strategies
- Tab/session targets
- Transport adapters

## Development

### Build Commands

```bash
# Build TypeScript
npm run build

# Watch mode for development
npm run watch

# Clean build artifacts
npm run clean
```

### Project Structure

```
ai-uinify/
├── config/           # Provider configurations
├── src/
│   ├── orchestrator/  # Core dispatch logic
│   └── dashboard/     # UI components
├── popup.html       # Extension popup UI
├── popup.js         # Popup controller
├── background.js    # Service worker
├── content.js       # Content script
├── manifest.json    # Extension manifest
└── package.json     # Dependencies
```

## Known Limitations

- Provider injection (content scripts) are currently mock implementations
- No actual communication with AI provider tabs yet
- TypeScript compilation required before loading extension
- Icons not yet created (extension uses manifest defaults)

## Roadmap

- [ ] Implement actual provider tab communication
- [ ] Add response aggregation and display
- [ ] Create extension icons
- [ ] Add user preferences/settings page
- [ ] Implement context scope UI controls
- [ ] Add conversation history viewer
- [ ] Support for additional AI providers (Claude, etc.)

## License

MIT License - see LICENSE file for details

## Contributing

Contributions welcome! Please open an issue or submit a pull request.

---

Provider registry configuration: `config/providers.ts`