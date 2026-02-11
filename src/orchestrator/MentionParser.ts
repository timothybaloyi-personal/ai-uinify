import { ParsedMentionMessage, ProviderRegistry } from "./types";

export class MentionParser {
  constructor(private readonly providerRegistry: ProviderRegistry) {}

  parse(composedPrompt: string): ParsedMentionMessage[] {
    const aliasPattern = this.buildAliasPattern();
    const matchRegex = new RegExp(`(${aliasPattern})\\b`, "gi");

    const matches = [...composedPrompt.matchAll(matchRegex)];

    if (matches.length === 0) {
      return [];
    }

    const parsed: ParsedMentionMessage[] = [];

    for (let index = 0; index < matches.length; index += 1) {
      const current = matches[index];
      const next = matches[index + 1];

      const mention = current[1].toLowerCase();
      const start = current.index + current[1].length;
      const end = next?.index ?? composedPrompt.length;
      const content = composedPrompt.slice(start, end).trim();

      if (!content) {
        continue;
      }

      parsed.push({
        alias: mention,
        content,
      });
    }

    return parsed;
  }

  private buildAliasPattern(): string {
    const aliases = Object.keys(this.providerRegistry)
      .map((alias) => alias.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"))
      .sort((a, b) => b.length - a.length);

    return aliases.join("|");
  }
}
