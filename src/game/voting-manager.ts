export interface Vote {
  voterId: number;
  targetId: number;
}

export interface RevealPayload {
  trueBotId: number;
  tally: Record<number, number>;
}

export class VotingManager {
  // roomId -> (voterId -> targetId). Map keying gives one vote per voter.
  private votes = new Map<string, Map<number, number>>();

  private roomVotes(roomId: string): Map<number, number> {
    let room = this.votes.get(roomId);
    if (!room) {
      room = new Map();
      this.votes.set(roomId, room);
    }
    return room;
  }

  castVote(roomId: string, { voterId, targetId }: Vote): void {
    const room = this.roomVotes(roomId);
    if (room.has(voterId)) {
      throw new Error(`voter ${voterId} has already voted in room ${roomId}`);
    }
    room.set(voterId, targetId);
  }

  tallyVotes(roomId: string): Record<number, number> {
    const tally: Record<number, number> = {};
    for (const targetId of this.roomVotes(roomId).values()) {
      tally[targetId] = (tally[targetId] ?? 0) + 1;
    }
    return tally;
  }

  calculateScores(roomId: string, botId: number): Record<number, number> {
    const scores: Record<number, number> = {};
    for (const [voterId, targetId] of this.roomVotes(roomId)) {
      // 1 point for correctly fingering the bot; non-guessers are omitted.
      if (targetId === botId) {
        scores[voterId] = 1;
      }
    }
    return scores;
  }

  getRevealPayload(roomId: string, botId: number): RevealPayload {
    return {
      trueBotId: botId,
      tally: this.tallyVotes(roomId),
    };
  }
}
