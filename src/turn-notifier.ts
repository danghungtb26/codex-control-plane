import type { CodexAppServerClient, TurnCompletedEvent } from "./codex-client.js";
import type { DiscordNotificationTarget, DiscordNotifier } from "./discord-notifier.js";

type TurnContext = DiscordNotificationTarget;

export class TurnNotifier {
  private contexts = new Map<string, TurnContext>();

  constructor(
    codex: CodexAppServerClient,
    private readonly discord: DiscordNotifier,
  ) {
    codex.on("turnCompleted", (event: TurnCompletedEvent) => {
      void this.handleCompleted(event);
    });
  }

  register(turnId: string, context: TurnContext) {
    if (!turnId) return;
    this.contexts.set(turnId, context);
  }

  private async handleCompleted(event: TurnCompletedEvent) {
    const context = this.contexts.get(event.turnId);
    if (!context) return;
    this.contexts.delete(event.turnId);

    try {
      await this.discord.sendCompletion({
        ...context,
        turnId: event.turnId,
        status: event.status,
      });
    } catch (error) {
      console.error("[discord] notification failed:", (error as Error).message);
    }
  }
}
