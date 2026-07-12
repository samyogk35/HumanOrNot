export interface PlayerInput {
  id: number;
  username: string;
}

export interface Player extends PlayerInput {
  isBot: boolean;
}

// Public payload deliberately omits isBot so clients can't tell who the bot is.
export type PublicPlayer = Omit<Player, 'isBot'>;

export type PublishFn = (payload: {
  type: 'chat';
  roomId: string;
  senderId: number;
  text: string;
}) => void;

export class BotManager {
  private players = new Map<string, Player[]>();
  private cadences = new Map<string, NodeJS.Timeout>();

  private roomPlayers(roomId: string): Player[] {
    let list = this.players.get(roomId);
    if (!list) {
      list = [];
      this.players.set(roomId, list);
    }
    return list;
  }

  addHuman(roomId: string, player: PlayerInput): void {
    this.roomPlayers(roomId).push({ ...player, isBot: false });
  }

  injectBot(roomId: string, player: PlayerInput): void {
    const list = this.roomPlayers(roomId);
    if (list.some((p) => p.isBot)) {
      throw new Error('only one bot allowed per room');
    }
    list.push({ ...player, isBot: true });
  }

  getInternalPlayers(roomId: string): Player[] {
    return [...this.roomPlayers(roomId)];
  }

  /** Player list safe to send to clients: isBot stripped out entirely. */
  getPublicPlayers(roomId: string): PublicPlayer[] {
    return this.roomPlayers(roomId).map(({ isBot, ...rest }) => rest);
  }

  private getBot(roomId: string): Player | undefined {
    return this.roomPlayers(roomId).find((p) => p.isBot);
  }

  startBotCadence(roomId: string, publishFn: PublishFn, intervalMs: number): void {
    // Replace any existing cadence for the room.
    this.stopBotCadence(roomId);

    const timer = setInterval(() => {
      const bot = this.getBot(roomId);
      if (!bot) return;
      publishFn({
        type: 'chat',
        roomId,
        senderId: bot.id,
        text: '',
      });
    }, intervalMs);

    this.cadences.set(roomId, timer);
  }

  stopBotCadence(roomId: string): void {
    const timer = this.cadences.get(roomId);
    if (timer) {
      clearInterval(timer);
      this.cadences.delete(roomId);
    }
  }
}
